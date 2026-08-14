# 영속성 (Redis / MySQL)

> 상위 원칙은 [DESIGN.md](../../DESIGN.md). Java 원본: `game/match/`,
> `game/ranking/`, `user/domain·repository`, Flyway `db/migration/`.
> Redis 키 스킴 전체는 [rooms-and-sessions.md](rooms-and-sessions.md).

## 저장소 분리

| 저장소 | 담는 것 | 특성 |
|---|---|---|
| Redis | 방, 세션(게스트·회원 공용), 진행 중 게임 상태, 점수판, 퀵매치 큐, OAuth state·로그인 코드 | 휘발 허용, TTL, Lua 원자성 |
| MySQL | 계정(users), 소셜 연동(social_accounts), 전적(matches·match_participants) | 영속, 스키마 마이그레이션 |

경계 규칙: **게임이 진행되는 동안 MySQL을 만지지 않는다.** MySQL 쓰기는 게임
종료 시점의 전적 보관(archive) 한 곳이고, 랭킹 집계는 그 기록을 읽는다.

## MySQL 스키마 (Flyway V1·V2 — 전환기 스키마 동결)

```sql
-- V1: 계정. 게스트는 Redis에만 산다 — users는 회원의 경계다.
users(id VARCHAR(36) PK,             -- UUID 문자열: 게스트 id와 호환(X-User-Id·roster 공용)
      nickname VARCHAR(20) NOT NULL,
      profile_image_url VARCHAR(500) NULL,
      created_at, updated_at DATETIME(6) NOT NULL)
social_accounts(id BIGINT AI PK,
      user_id VARCHAR(36) NOT NULL FK→users,
      provider VARCHAR(20) NOT NULL, provider_user_id VARCHAR(64) NOT NULL,
      created_at DATETIME(6) NOT NULL,
      UNIQUE(provider, provider_user_id),   -- find-or-register 경합의 최종 방어선
      INDEX(user_id))

-- V2: 전적
matches(id BIGINT AI PK,
      game_id VARCHAR(64) NOT NULL UNIQUE,  -- 중복 보관의 최종 방어선
      game_code VARCHAR(32) NOT NULL, room_code VARCHAR(12) NOT NULL,
      player_count INT NOT NULL,
      finished_at DATETIME(6) NOT NULL,     -- UTC 벽시계
      INDEX(finished_at))
match_participants(id BIGINT AI PK,
      match_id BIGINT NOT NULL FK→matches,
      user_id VARCHAR(36) NULL FK→users,    -- NULL = 게스트(랭킹 제외, 기록은 보존)
      player_id VARCHAR(64) NOT NULL,
      display_nickname VARCHAR(20) NOT NULL,-- 당시 표시 이름 동결
      total_score INT NOT NULL, ranking INT NOT NULL,
      INDEX(match_id), INDEX(user_id))
```

- Flyway 설정 중 계약인 것: `baseline-on-migrate: true` + **`baseline-version: 0`**
  (기본값 1이면 V1이 적용된 것으로 오인되어 건너뛴다).
- 전환기(같은 DB를 두 백엔드가 보는 기간)에는 **스키마 변경 금지**. Node 쪽
  마이그레이션 도구는 Phase 4에서 ADR로 결정 — 판단 기준은 Flyway
  이력 테이블(`flyway_schema_history`)과의 호환(기존 V1·V2를 "이미 적용됨"으로
  인식할 것).

## 전적 보관 (MatchArchiveService)

- 호출 시점: ① 게임 종료(`GameCompletionService` — **실패해도 삼킨다**, 종료를
  막지 않음) ② 탁구 AI 결과 REST.
- 한 트랜잭션에 matches 1행 + 참가자 N행. `finished_at`은 **UTC 고정 시계**
  (dev KST / prod UTC의 9시간 스큐는 주간 집계에 복구 불가능한 오염 —
  Java가 명시적으로 `Clock.systemUTC()`를 쓰는 이유).
- 멱등: `existsByGameId` 사전 확인 + 유니크 제약. 경합의 유니크 위반은 "이미
  보관됨"(false)으로 처리.
- 회원 판정은 **users 테이블 존재 여부**다(Redis 세션 아님 — 게임 중 세션이
  만료된 회원이 게스트로 강등되면 안 된다).
- 닉네임 우선순위: 방 표시 이름 → 프로필 닉네임 → playerId 원문, 20자 절단,
  공백이면 "플레이어".

## 주간 랭킹 (WeeklyRankingService)

- **주 경계 = KST 월요일 00:00**(코드에 Asia/Seoul 고정, TZ 환경변수 무관).
  저장은 UTC이므로 질의 구간은 KST 경계를 UTC 벽시계로 변환한 [from, to)
  반개구간이다(KST 월 00:00 == UTC 일 15:00).
- 집계: **회원만**(`user_id IS NOT NULL`), 주간 **최고 점수 1건**(누적 아님),
  `MAX(total_score)` GROUP BY 회원, 점수 내림차순 + userId 오름차순
  타이브레이크(페이지네이션 안정성). 닉네임은 **현재 프로필 이름**(동결된
  display_nickname 아님).
- 게임 코드는 질의 파라미터지만 서비스가 **YACHT_DICE로 고정**한다 —
  duel·pingpong·AI 매치는 보관은 되지만 랭킹에는 안 잡힌다(계약).
- 내 순위: `내 최고점보다 큰 점수를 가진 회원 수(DISTINCT) + 1` — 목록의
  1,2,2,4 번호 매김과 정확히 일치한다. 기록 없음은 null(→ REST 204).
- limit은 서버에서 [1,100] 클램프.

### 캐시

- 인프로세스 캐시(주간 상위 목록만). 키 = `gameCode|weekStart|limit` —
  weekStart가 키에 들어 있어 주가 바뀌면 자연히 새 엔트리다(지난주 잔존 불가).
- 무효화는 전적 보관 시 **무조건 전체 evict**(중복 보관이어도 — 조건 분기보다
  캐시 미스 1회가 싸다).
- 내 순위 질의는 캐시하지 않는다(회원 수만큼 엔트리가 늘어난다).
- Node 이식: 단일 인스턴스 전제 그대로 인메모리 Map + 위 키 규약이면 충분하다.
  Redis 캐시로 옮기는 것은 수평 확장 ADR과 함께.

### 랭킹 REST

[auth.md](auth.md)의 인증 절 참고. 응답 모양:

```json
// GET /api/v1/rankings/weekly?limit=50   (무인증, 항상 200)
{ "weekStart": "2026-08-10",
  "entries": [ { "rank": 1, "userId": "...", "nickname": "...", "bestScore": 300 } ] }
// GET /api/v1/rankings/weekly/me   (Bearer) — 204 = 이번 주 무기록
{ "weekStart": "2026-08-10", "rank": 27, "bestScore": 184 }
```

rank 번호는 응답 조립 시 부여(동점 공동·다음 순위 건너뜀 — 1,2,2,4).

## 클라이언트

- Redis: `ioredis`, lazyConnect. Lua는 `defineCommand`로 등록해 스크립트
  단위로 테스트한다. 반환 코드 매핑은 각 설계 문서의 표가 계약이다.
- MySQL: `mysql2/promise` 풀(`infra/mysql.ts`). ORM 미도입(ADR-0003) — 필요
  쿼리는 전적 보관 insert 2종 + 랭킹 select 3종 + 계정 CRUD 소수라 raw SQL로
  충분하다. 쿼리가 늘어나면 재검토.
