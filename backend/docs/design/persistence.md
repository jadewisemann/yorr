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

## 마이그레이션 (전환기 스키마 동결)

Node 쪽 도구는 **Flyway 이력 테이블 위에서 도는 자체 러너**다
([ADR-0005](../adr/0005-flyway-compatible-migration-runner.md), `src/infra/migrations/`).
새 의존성 없음 — `flyway_schema_history`를 그대로 읽고 쓴다.

- SQL은 `backend/db/migration/`. V1·V2는 backend-java 원본의 **바이트 단위
  사본**이다(체크섬이 내용에서 나온다 — 한 글자도 고치면 운영 이력과 어긋난다).
- 체크섬은 Flyway와 같은 값이다: 줄 종결자를 뺀 각 줄의 UTF-8 바이트에 대한
  CRC32(signed int). 줄 종결자 종류·파일 끝 개행·BOM에 영향받지 않는다.
- 버전 판정도 Flyway와 같다: 숫자 단위 비교, `1` == `1.0`, baseline **이하**는
  적용 대상이 아니다.

**전환기(같은 DB를 두 백엔드가 보는 기간)에는 스키마 변경 금지다.** 관례가 아니라
기계적 이유가 있다 — Java의 Flyway는 부팅마다 `validateOnMigrate`로 이력을
파일 목록과 대조하므로, Node가 새 마이그레이션을 적용하고 이력에 행을 쓰면
**backend-java가 다음 부팅에서 뜨지 못한다**. 스키마 변경이 필요하면
backend-java의 Flyway로 넣고 같은 파일을 `backend/db/migration/`에 복사한다.

이 동결이 코드에도 박혀 있다:

| 진입점 | 하는 일 | 쓰는 곳 |
|---|---|---|
| `verifyMigrations(pool)` | **읽기 전용 확인.** 이력 테이블조차 만들지 않는다. 미적용 마이그레이션·실패 이력 행이 있으면 던진다 | 서버 기동(4.2에서 배선) |
| `runMigrations(pool)` | 밀린 것을 실제로 적용 | 빈 개발 DB, 통합 테스트 |

- 체크섬 불일치는 기본적으로 **보고만** 한다(`validateChecksums: true`로 승격).
  우리 계산이 Java와 어긋났을 때 운영 부팅이 막히는 형태로 드러나면 안 된다.
- 이력에는 있는데 파일이 없는 것(`missingLocally`)은 던지지 않는다 — Java가 앞서
  나간 상태이고 남는 테이블이 질의를 깨뜨리지는 않는다. 경고 로그로 남긴다.
- MySQL DDL은 암묵 커밋이라 롤백이 없다. 실패한 마이그레이션은 Flyway와 같이
  `success = 0`으로 이력에 남고, 복구는 사람이 스키마를 확인하고 그 행을 지우는
  것이다.

## 프로필 (users) — dual-write 불변식

닉네임은 **두 곳**에 산다. 어느 쪽이 정본인지가 이 절의 전부다.

| 저장소 | 값 | 역할 | 수명 |
|---|---|---|---|
| MySQL `users.nickname` | **정본** | 영구 프로필 | 계정 수명 |
| Redis `user:{id}.nickname` | 사본 | 인증·화면·방 명단이 실제로 읽는 값 | 세션 TTL(회원 30일 슬라이딩) |
| MySQL `match_participants.display_nickname` | 스냅샷 | 그 판에 보였던 이름 | 영구, **불변** |

- **개명은 두 곳을 함께 쓴다(dual-write).** DB만 고치면 다시 로그인하기 전까지
  방 명단에 옛 이름이 남고, 세션만 고치면 세션이 만료되는 순간 되돌아간다.
- **쓰기 순서는 DB → 세션이다.** 뒤집으면(=Java의 순서, `renameSession`이
  `@Transactional` 커밋 전에 불린다) DB 커밋이 실패했을 때 세션에만 새 이름이
  남아 영구히 갈라진다. 이 순서에서 최악은 "DB는 새 이름·세션은 옛 이름"이고
  그건 다음 로그인이 저절로 맞춘다. **Java와 의도적으로 다른 유일한 지점**이다.
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
  **500**이다. 이 비대칭은 Java 컨트롤러 그대로이며 재현한다(quirk).
- 규칙 위반과 부재의 우선순위: 정규화가 조회보다 **먼저**라, 없는 회원 + 잘못된
  이름이면 `invalid_nickname`(400)이 이긴다.

요청·응답 모양은 [auth.md](auth.md)의 「프로필 REST」가 정본이다.

### 구현 위치 (Node)

| 파일 | 대응 Java |
|---|---|
| `user/profile.ts` — `UserProfileService`·`UserProfileRepository`·`MysqlUserProfileStore`·`UserNotFoundError` | `user/application/UserProfileService` + `user/repository/UserRepository` + `user/domain/User.rename` |
| `http/routes/users.ts` — `registerUserRoutes` | `user/controller/UserProfileController` |

- 세션 쪽은 좁은 포트(`SessionNicknameWriter`)로만 잡는다. `UserService`가
  구조적으로 이를 만족하므로 배선은 그대로이고, MySQL 없는 환경에서도 라우트
  계약을 시험할 수 있다.
- 이식된 테스트(4.3): `user/__tests__/profile.test.ts`가 Java
  `UserProfileServiceIntegrationTest` 4종을 **두 벌** 돌린다 — 인메모리 저장소 +
  진짜 Redis(항상), 실 MySQL + 진짜 Redis(`MYSQL_TEST_URL`이 있을 때만).
  `http/routes/__tests__/users.test.ts`가 401·403·400·404·500 표면과 dual-write를
  고정한다.

## 전적 보관 (MatchArchiveService)

- 호출 시점: ① 게임 종료(`GameCompletionService` — **실패해도 삼킨다**, 종료를
  막지 않음) ② 탁구 AI 결과 REST.
- 한 트랜잭션에 matches 1행 + 참가자 N행. `finished_at`은 **UTC 고정 시계**
  (dev KST / prod UTC의 9시간 스큐는 주간 집계에 복구 불가능한 오염 —
  Java가 명시적으로 `Clock.systemUTC()`를 쓰는 이유).
- 멱등 키는 **`game_id`** 하나다: 트랜잭션 안의 사전 확인(`SELECT ... WHERE
  game_id = ?`) + `uk_matches_game` 유니크 제약. 사전 확인은 동시 호출에서 깨지므로
  최종 방어선은 제약이고, 그 유니크 위반(errno 1062)만 "이미 보관됨"(false)이다.
- **유니크가 아닌 제약 위반은 던진다**(Java와 의도적 차이 — Java는
  `DataIntegrityViolationException` 전체를 false로 뭉갠다). FK·길이 위반은 "저장되지
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
  Java `@CacheEvict`가 메서드 프록시라 **중복 판·검증 실패 호출에도 비워지는** 관용을
  그대로 옮겼다.

### 구현 위치 (Node)

| 파일 | 대응 Java |
|---|---|
| `game/match/matchArchiveService.ts` — `MatchArchiveService`(`archive(room, rankings)` · `archiveParticipants(input)`), `resolveDisplayNickname` | `game/match/application/MatchArchiveService` + `MatchParticipant.of`의 이름 규칙 |
| `game/match/matchArchiveStore.ts` — `MatchArchiveStore`(포트) · `MysqlMatchArchiveStore` | `MatchRepository` + `UserRepository.findById` |
| `game/match/index.ts` | 공개 표면(배선·탁구 AI REST는 여기만 import) |

- `MatchArchiveService`는 2.7의 `MatchArchivePort`를 **구조적으로** 만족한다 —
  배선에서 `noopMatchArchive`를 이 인스턴스로 바꾸는 것 외에 다른 변경이 없다.
- 저장소를 포트로 뒤집은 이유는 4.3과 같다: 판정 로직(멱등·닉네임·회원 분기·시계)이
  MySQL 없이 시험돼야 한다. 이식된 테스트(4.4):
  `game/match/__tests__/matchArchiveService.test.ts`가 Java
  `MatchArchiveServiceIntegrationTest`의 `MatchArchiveService` 4종을 인메모리 저장소로
  **항상** 돌리고, `matchArchiveStore.test.ts`가 같은 4종 + 제약·동시 보관·UTC 벽시계를
  실 MySQL에서(`MYSQL_TEST_URL`이 있을 때만) 확인한다.

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

Java는 `ZoneId.of("Asia/Seoul")`로 시간대 DB를 읽지만 Node 이식은 **+09:00 산술
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
- **Node 배치: Java의 `@Cacheable`/`@CacheEvict` 자리를 리포지토리
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
- `limit`이 정수가 아니면 **400 + 빈 본문**이다(Java는 `int limit`의 타입 변환
  실패로 400을 내는데 그 본문은 Spring이 만든 프레임워크 흔적이라 계약이 아니다 —
  score-candidates 400과 같은 판단). `?limit=`(빈 값)은 "주지 않은 것"으로 본다.

### 구현 위치 (Node)

| 파일 | 대응 Java |
|---|---|
| `game/ranking/weekBoundary.ts` — `weekBoundaryOf`·`KST_OFFSET_MINUTES` | `WeeklyRankingService.weekStart`·`utcWallClock` |
| `game/ranking/weeklyRankingStore.ts` — `WeeklyRankingRepository`·`MysqlWeeklyRankingStore` | `MatchParticipantRepository`의 집계 3종 |
| `game/ranking/weeklyRankingCache.ts` — `CachingWeeklyRankingRepository`·`WeeklyRankingCacheEvictor`·`weeklyRankingCacheKey` | `config/CacheConfig` + `@Cacheable`/`@CacheEvict` |
| `game/ranking/weeklyRankingService.ts` — `WeeklyRankingService`·`MAX_LIMIT` | `game/ranking/application/WeeklyRankingService` |
| `game/ranking/weeklyRankingResponse.ts` — `weeklyRankingResponse` | `controller/dto/WeeklyRankingResponse.of` |
| `http/routes/ranking.ts` — `registerRankingRoutes` | `game/ranking/controller/RankingController` |

- 집계 질의 인터페이스를 **전적 패키지가 아니라 랭킹 모듈**에 둔다(Java는
  `game/match/repository`). 읽는 쪽이 소유하면 보관(쓰기)과 랭킹(읽기)이 서로의
  파일을 건드리지 않고 같은 테이블을 나눠 쓴다 — 결합은 Flyway V2 스키마 하나다.
- 이식된 테스트(4.5): 주 경계(초·밀리초 단위)·동점 번호·캐시 키·evict·limit
  클램프·REST 표면은 **MySQL 없이** 돈다(`Intl` 대조 포함). 실 MySQL이 필요한
  것은 집계 SQL 자체(게스트 제외·GROUP BY·현재 닉네임·반개구간)뿐이고
  `MYSQL_TEST_URL`이 있을 때만 돈다.

## 클라이언트

- Redis: `ioredis`, lazyConnect. Lua는 `defineCommand`로 등록해 스크립트
  단위로 테스트한다. 반환 코드 매핑은 각 설계 문서의 표가 계약이다.
- MySQL: `mysql2/promise` 풀(`infra/mysql.ts`, `createMysqlPool`/`closeMysqlPool`).
  ORM 미도입(ADR-0003) — 필요 쿼리는 전적 보관 insert 2종 + 랭킹 select 3종 +
  계정 CRUD 소수라 raw SQL로 충분하다. 쿼리가 늘어나면 재검토.
- 풀은 태생이 lazy라 ioredis의 `lazyConnect`에 해당하는 옵션이 없다 — 첫 질의
  전에는 커넥션을 열지 않으므로 **MySQL 없이도 서버 기동은 성공한다**.
- **`timezone: 'Z'`가 계약이다.** `DATETIME(6)`은 UTC 벽시계인데(위의
  `finished_at`) mysql2 기본값 `'local'`은 Date ↔ DATETIME 변환에 프로세스 TZ를
  쓴다. 개발 컨테이너는 Asia/Seoul, 운영은 UTC라 그대로 두면 같은 코드가 환경마다
  9시간 어긋난 값을 쓴다 — Java가 `Clock.systemUTC()`를 명시하는 것과 같은 이유로
  드라이버 쪽에서도 못박는다.
- `multipleStatements`는 끈다. 마이그레이션 SQL은 러너가 문장 단위로 잘라
  보낸다(ADR-0005) — 마이그레이션 한 곳 때문에 애플리케이션 풀 전체에 인젝션
  피해 범위를 넓히지 않는다.
