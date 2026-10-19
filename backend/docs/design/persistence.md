# 영속성 (저장소 / DB)

> 상위 원칙은 [DESIGN.md](../../DESIGN.md).
> 키 스킴 전체는 [rooms-and-sessions.md](rooms-and-sessions.md).
> 둘 다 프로세스 안에 있다 — [ADR-0007](../adr/0007-botkeep-single-process.md).

## 저장소 분리

| 저장소 | 담는 것 | 특성 |
|---|---|---|
| 저장소(`MemoryRedis`) | 방, 세션(게스트·회원 공용), 진행 중 게임 상태, 점수판, 퀵매치 큐, OAuth state·로그인 코드 | TTL, 원자적 스크립트, 키 수 상한, 스냅샷(정상 종료 + 60초마다)으로 재시작을 넘긴다 |
| DB(SQLite `data/yorr.db`) | 계정(users), 소셜 연동(social_accounts), 전적(matches·match_participants) | 영속, 파일 하나 |

저장소는 Redis 명령 이름과 시맨틱(문자열 값·TTL·빈 해시 삭제·WRONGTYPE)을 흉내 내는
프로세스 안의 구현이다. 그래서 저장소 클래스 이름에 `Redis`가 남아 있다.

경계 규칙: **게임이 진행되는 동안 DB를 만지지 않는다.** DB 쓰기는 게임
종료 시점의 전적 보관(archive) 한 곳이고, 랭킹 집계는 그 기록을 읽는다.

## DB 스키마

정본은 `infra/sqlite.ts`의 `SQLITE_SCHEMA`다. 풀이 파일을 처음 열 때 `CREATE TABLE IF NOT
EXISTS`로 맞춘다 — 마이그레이션 러너는 없다(MySQL 시절의 Flyway 호환 러너는 ADR-0007에서
지웠다). 모양은 MySQL 시절 V1·V2와 같고, 길이 제한은 `CHECK (length(...) <= n)`으로 옮겼다.

```sql
-- 계정. 게스트는 저장소에만 산다 — users는 회원의 경계다.
users(id TEXT PK ≤36,                -- UUID 문자열: 게스트 id와 호환(X-User-Id·roster 공용)
      nickname TEXT NOT NULL ≤20,
      profile_image_url TEXT NULL ≤500,
      created_at, updated_at TEXT NOT NULL)   -- ISO 8601 UTC
social_accounts(id INTEGER PK AUTOINCREMENT,
      user_id TEXT NOT NULL FK→users,
      provider TEXT NOT NULL ≤20, provider_user_id TEXT NOT NULL ≤64,
      created_at TEXT NOT NULL,
      UNIQUE(provider, provider_user_id),   -- find-or-register 경합의 최종 방어선
      INDEX(user_id))

-- 전적
matches(id INTEGER PK AUTOINCREMENT,
      game_id TEXT NOT NULL UNIQUE ≤64,     -- 중복 보관의 최종 방어선
      game_code TEXT NOT NULL ≤32, room_code TEXT NOT NULL ≤12,
      player_count INTEGER NOT NULL,
      finished_at TEXT NOT NULL,            -- ISO 8601 UTC
      INDEX(finished_at))
match_participants(id INTEGER PK AUTOINCREMENT,
      match_id INTEGER NOT NULL FK→matches,
      user_id TEXT NULL FK→users,           -- NULL = 게스트(랭킹 제외, 기록은 보존)
      player_id TEXT NOT NULL ≤64,
      display_nickname TEXT NOT NULL ≤20,   -- 당시 표시 이름 동결
      total_score INTEGER NOT NULL, ranking INTEGER NOT NULL,
      INDEX(match_id), INDEX(user_id))
```

- **시각은 `Date.toISOString()` 한 형식으로만 적는다.** 형식이 하나라 문자열 비교가 곧
  시각 비교이고, 주간 랭킹의 기간 질의(`finished_at >= ? AND < ?`)가 그 위에 선다.
- 스키마를 바꾸려면 `SQLITE_SCHEMA`를 고친다. `IF NOT EXISTS`는 **새 테이블만** 만든다 —
  기존 테이블에 열을 더하는 변경은 `ALTER TABLE`을 같은 자리에 함께 적어야 한다.

## 프로필 (users) — dual-write 불변식

닉네임은 **두 곳**에 산다. 어느 쪽이 정본인지가 이 절의 전부다.

| 저장소 | 값 | 역할 | 수명 |
|---|---|---|---|
| DB `users.nickname` | **정본** | 영구 프로필 | 계정 수명 |
| 저장소 `user:{id}.nickname` | 사본 | 인증·화면·방 명단이 실제로 읽는 값 | 세션 TTL(회원 30일 슬라이딩) |
| DB `match_participants.display_nickname` | 스냅샷 | 그 판에 보였던 이름 | 영구, **불변** |

- **개명은 두 곳을 함께 쓴다(dual-write).** DB만 고치면 다시 로그인하기 전까지
  방 명단에 옛 이름이 남고, 세션만 고치면 세션이 만료되는 순간 되돌아간다.
- **쓰기 순서는 DB → 세션이다.** 뒤집으면(`renameSession`이
  `@Transactional` 커밋 전에 불린다) DB 커밋이 실패했을 때 세션에만 새 이름이
  남아 영구히 갈라진다. 이 순서에서 최악은 "DB는 새 이름·세션은 옛 이름"이고
  그건 다음 로그인이 저절로 맞춘다.
- **세션이 없어도 개명은 성공한다.** `renameSession`은 `user:{id}`가 있을 때만
  쓴다(죽은 세션을 되살리지 않는다 — 세션 계약은 rooms-and-sessions.md).
- **닉네임 규칙은 `user/session.ts`의 `normalizeNickname` 한 곳뿐이다**(trim 후
  1~20자, 문자 종류 제약 없음). 게스트 생성·방 입장·프로필 개명이 같은 함수를
  부른다 — 규칙을 복제하면 조용히 갈라진다.
- **지난 판의 기록은 소급되지 않는다.** `display_nickname`은 그때 화면에 보였던
  이름이라 개명이 과거 전적까지 바꾸면 안 된다. 반대로 주간 랭킹의 닉네임은
  **현재 프로필 이름**이다(아래 랭킹 절) — 둘의 차이가 계약이다.

### member_only 게이트

프로필 REST는 Bearer 토큰만으로 인증하고(`X-User-Id` 없음) **회원인지까지** 본다.

- 게스트 토큰: 인증은 성공하지만 `users` 행 자체가 없다 → **403 `member_only`**.
  401(재로그인하면 풀린다)과 구분되는 상태다 — 게스트는 다시 로그인해도
  프로필이 생기지 않는다.
- 세션 실패: **401 `session_expired`**(방 REST의 `invalid_guest_session`이
  아니다 — API마다 401 본문이 다른 것이 계약이다).
- 회원 행이 사라진 세션: `PATCH`는 **404 `user_not_found`**, `GET`은 잡지 않아
  **500**이다. 이 비대칭 자체가 계약이라 통일하지 않는다.
- 규칙 위반과 부재의 우선순위: 정규화가 조회보다 **먼저**라, 없는 회원 + 잘못된
  이름이면 `invalid_nickname`(400)이 이긴다.

요청·응답 모양은 [auth.md](auth.md)의 「프로필 REST」가 정본이다.

### 구현 위치 (Node)

| 파일 |
|---|
| `user/profile.ts` — `UserProfileService`·`UserProfileRepository`·`SqliteUserProfileStore`·`UserNotFoundError` |
| `http/routes/users.ts` — `registerUserRoutes` |

- 세션 쪽은 좁은 포트(`SessionNicknameWriter`)로만 잡는다. `UserService`가
  구조적으로 이를 만족하므로 배선은 그대로이고, DB 없이도 라우트 계약을 시험할 수 있다.
- 테스트: `user/__tests__/profile.test.ts`가
  `UserProfileServiceIntegrationTest` 4종을 **두 벌** 돌린다 — 인메모리 저장소와
  인메모리 SQLite(`useDb`). 둘 다 항상 돈다.
  `http/routes/__tests__/users.test.ts`가 401·403·400·404·500 표면과 dual-write를
  고정한다.

## 전적 보관 (MatchArchiveService)

- 호출 시점: ① 게임 종료(`GameCompletionService` — **실패해도 삼킨다**, 종료를
  막지 않음) ② 탁구 AI 결과 REST.
- 한 트랜잭션에 matches 1행 + 참가자 N행. `finished_at`은 **UTC 고정 시계**
  (dev KST / prod UTC의 9시간 스큐는 주간 집계에 복구 불가능한 오염이다).
- 멱등 키는 **`game_id`** 하나다: 트랜잭션 안의 사전 확인(`SELECT ... WHERE
  game_id = ?`) + `uk_matches_game` 유니크 제약. 사전 확인은 동시 호출에서 깨지므로
  최종 방어선은 제약이고, 그 유니크 위반(errno 1062)만 "이미 보관됨"(false)이다.
- **유니크가 아닌 제약 위반은 던진다**(FK·길이 위반은 "저장되지
  않았다"는 뜻이고, false로 뭉개면 사라진 판이 조용해진다. 종료 경로가 예외를 삼켜
  `onArchiveFailure`로 흘리므로 게임은 그대로 끝나고 사실은 로그에 남는다.
- 회원 판정은 **users 테이블 존재 여부**다(Redis 세션 아님 — 게임 중 세션이
  만료된 회원이 게스트로 강등되면 안 된다). 같은 조회가 방에 없는 참가자의 대체
  이름(프로필 닉네임)도 함께 가져온다.
- 닉네임 우선순위: 방 표시 이름 → 프로필 닉네임 → playerId 원문, 20자 절단,
  공백이면 "플레이어". 앞뒤 공백은 다듬지 않는다(방 이름은 이미
  `normalizeNickname`을 통과한 값이다).
- **시계는 주입한다**(`now: () => Date`, 기본 `new Date()`). `Date`는 순간이고 UTC
  벽시계로 적는 것은 풀의 `timezone: 'Z'`다 — 4.5의 KST 주 경계 질의가 이 조합에
  기댄다. 주입 가능한 이유는 그 경계를 초 단위로 시험하기 위해서다.
- 랭킹 캐시 무효화는 **주입되는 포트**(`RankingCacheInvalidator`)다. 주입하지 않아도
  보관은 동작하고, 무효화 실패는 보관 결과를 뒤집지 않는다(행은 이미 커밋됐다).
  **중복 판·검증 실패 호출에도 비워진다.** 그 관용을
  그대로 옮겼다.

### 구현 위치 (Node)

| 파일 |
|---|
| `game/match/matchArchiveService.ts` — `MatchArchiveService`(`archive(room, rankings)` · `archiveParticipants(input)`), `resolveDisplayNickname` |
| `game/match/matchArchiveStore.ts` — `MatchArchiveStore`(포트) · `MysqlMatchArchiveStore` |
| `game/match/index.ts` |

- `MatchArchiveService`는 2.7의 `MatchArchivePort`를 **구조적으로** 만족한다 —
  배선에서 `noopMatchArchive`를 이 인스턴스로 바꾸는 것 외에 다른 변경이 없다.
- 저장소를 포트로 뒤집은 이유는 4.3과 같다: 판정 로직(멱등·닉네임·회원 분기·시계)이
  DB 없이 시험돼야 한다. 이식된 테스트(4.4):
  `game/match/__tests__/matchArchiveService.test.ts`가
  `MatchArchiveServiceIntegrationTest`의 `MatchArchiveService` 4종을 인메모리 저장소로
  **항상** 돌리고, `matchArchiveStore.test.ts`가 같은 4종 + 제약·동시 보관·UTC 벽시계를
  인메모리 SQLite에서 확인한다(항상 돈다).

## 주간 랭킹 (WeeklyRankingService)

- **주 경계 = KST 월요일 00:00**(코드에 존 고정, TZ 환경변수 무관).
  저장은 UTC이므로 질의 구간은 KST 경계를 UTC로 변환한 [from, to) 반개구간이다
  (KST 월 00:00 == UTC 일 15:00). 월요일 00:00 정각은 **새 주에 속한다.**
- 집계: **회원만**(`user_id IS NOT NULL`), 주간 **최고 점수 1건**(누적 아님),
  `MAX(total_score)` GROUP BY 회원, 점수 내림차순 + userId 오름차순
  타이브레이크(페이지네이션 안정성). 닉네임은 **현재 프로필 이름**(동결된
  display_nickname 아님).
- 게임 코드는 질의 파라미터지만 서비스가 **YACHT_DICE로 고정**한다 —
  duel·pingpong·AI 매치는 보관은 되지만 랭킹에는 안 잡힌다(계약).
- 내 순위: `내 최고점보다 큰 점수를 가진 회원 수(DISTINCT) + 1` — 목록의
  1,2,2,4 번호 매김과 정확히 일치한다. 기록 없음은 null(→ REST 204).
  **0점은 기록이 있는 것**이다(순위에 오른다) — 무기록과 구분한다.
- limit은 서버에서 [1,100] 클램프.

#### KST 오프셋을 +9로 고정한다 (Node)

시간대 DB(`Intl`)를 읽지 않고 **+09:00 산술
고정**이다(`game/ranking/weekBoundary.ts`의 `KST_OFFSET_MINUTES`). 근거:

- 이 계산에 들어오는 시각은 "지금"과 "지금 + 7일"뿐이다. 대한민국은 현재
  서머타임이 없어(마지막 시행 1988년, +08:30 구간은 1961년까지) 그 범위에서
  `Asia/Seoul`의 오프셋은 +09:00 하나다 — 시간대 DB를 읽어도 같은 값이 나온다.
- 얻는 것: 결과가 Node의 ICU 빌드나 컨테이너 tzdata 버전에 걸리지 않는다.
- 대가(한국이 서머타임을 되살리면 틀린다)는 **조용히 틀리지 않는다** —
  `__tests__/weekBoundary.test.ts`가 `Intl`의 `Asia/Seoul` 실측 오프셋을 앞으로
  4년치 대조하므로 tzdata가 바뀌면 테스트가 먼저 깨진다.

### 캐시

- 인프로세스 캐시(주간 상위 목록만). 키 = `gameCode|from(UTC ISO)|limit` —
  `from`(= 주 시작)이 키에 들어 있어 주가 바뀌면 자연히 새 엔트리다(지난주 잔존
  불가). `limit`이 키에 있는 이유: 목록은 이미 잘린 결과라 `limit=10`의 값을
  `limit=100` 요청에 재사용하면 90명이 사라진다.
- 무효화는 전적 보관 시 **무조건 전체 evict**(중복 보관이어도 — 조건 분기보다
  캐시 미스 1회가 싸다). 주·게임별로 골라 버리지 않는다.
- 내 순위 질의는 캐시하지 않는다(회원 수만큼 엔트리가 늘어난다).
- 단일 인스턴스 전제 그대로 인메모리 `Map`이다(DESIGN.md 원칙 8). Redis 캐시로
  옮기는 것은 수평 확장 ADR과 함께.
- **배치: 캐시 적재·무효화를 리포지토리
  데코레이터로 잡는다.** `CachingWeeklyRankingRepository`가
  `WeeklyRankingRepository`를 구현하며 감싸므로 서비스는 캐시의 존재를 모른다 —
  끼우거나 빼도 서비스 계약이 그대로다. 전적 보관(archive)은 좁은 포트
  `WeeklyRankingCacheEvictor { evictAll() }`만 알면 되고, 두 슬라이스를 잇는
  것은 `server.ts`의 배선이다.

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

- **상위 목록은 무인증이다.** 순위에 오르는 것은 회원만이지만 보는 것은
  누구나다 — 로그인해야 볼 수 있게 하면 "로그인하면 무엇이 남는가"를 보여줄
  자리가 사라진다(랜딩의 랭킹 티커가 비로그인 상태에서 읽는다). 죽은 토큰을
  들고 와도 목록은 200이다.
- `/weekly/me`의 오류 본문은 **plain-text 소문자 코드**다(프로필·auth REST와 같은
  결. 조회 REST 2.9의 JSON `{code,message}`가 아니다): 세션 실패 401
  `session_expired`, 게스트 403 `member_only`(다시 로그인해도 오를 자리가 생기지
  않으므로 401이 아니다).
- `limit`이 정수가 아니면 **400 + 빈 본문**이다(타입 변환 실패의 400 본문은
  프레임워크 흔적이라 계약이 아니다 —
  score-candidates 400과 같은 판단). `?limit=`(빈 값)은 "주지 않은 것"으로 본다.

### 구현 위치 (Node)

| 파일 |
|---|
| `game/ranking/weekBoundary.ts` — `weekBoundaryOf`·`KST_OFFSET_MINUTES` |
| `game/ranking/weeklyRankingStore.ts` — `WeeklyRankingRepository`·`MysqlWeeklyRankingStore` |
| `game/ranking/weeklyRankingCache.ts` — `CachingWeeklyRankingRepository`·`WeeklyRankingCacheEvictor`·`weeklyRankingCacheKey` |
| `game/ranking/weeklyRankingService.ts` — `WeeklyRankingService`·`MAX_LIMIT` |
| `game/ranking/weeklyRankingResponse.ts` — `weeklyRankingResponse` |
| `http/routes/ranking.ts` — `registerRankingRoutes` |

- 집계 질의 인터페이스를 **전적 패키지가 아니라 랭킹 모듈**에 둔다. 읽는 쪽이 소유하면 보관(쓰기)과 랭킹(읽기)이 서로의
  파일을 건드리지 않고 같은 테이블을 나눠 쓴다 — 결합은 `SQLITE_SCHEMA`의 전적 테이블 하나다.
- 이식된 테스트(4.5): 주 경계(초·밀리초 단위)·동점 번호·캐시 키·evict·limit
  클램프·REST 표면은 **DB 없이** 돈다(`Intl` 대조 포함). 집계 SQL 자체(게스트 제외·
  GROUP BY·현재 닉네임·반개구간)는 인메모리 SQLite에서 확인한다.

## 클라이언트

- 저장소: `infra/memoryRedis.ts`. 동기 명령 집합(`RedisCore`) 위에 ioredis 모양의 비동기
  겉면(`MemoryRedis`)을 얹었다. 동시성 있는 전이는 `AtomicScript`(동기 함수 하나)로 한 번에
  검증+갱신한다 — 도중에 `await`가 없으므로 다른 명령이 끼어들지 않는다. 반환 코드 매핑은
  각 설계 문서의 표가 계약이다. 만료는 접근할 때 확인하고 60초마다 회수한다.
- DB: `infra/sqlite.ts`(`createDbPool`/`closeDbPool`). Node 내장 `node:sqlite` 위에
  `query`·`getConnection`·트랜잭션만 있는 작은 풀을 구현했다. ORM 미도입(ADR-0003) — 필요
  쿼리는 전적 보관 insert 2종 + 랭킹 select 3종 + 계정 CRUD 소수라 raw SQL로 충분하다.
- 풀은 **첫 질의 때 파일을 연다** — DB를 건드리지 않는 기동·테스트는 파일을 만들지 않는다.
- `DatabaseSync`는 커넥션 하나라 모든 질의·트랜잭션이 잠금 하나를 차례로 잡는다
  (`FOR UPDATE`는 지우고 그보다 강한 직렬화로 대신한다). 질의가 동기라 이벤트 루프를 잠깐
  막지만 DB 기록은 게임 종료·로그인에서만 일어난다.
- 제약 위반은 MySQL 시절의 `errno`(1062 등)로 바꿔 던진다 — 저장소의 판정 코드가 그 숫자다.
