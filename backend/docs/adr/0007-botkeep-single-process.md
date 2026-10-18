# ADR-0007: Botkeep에는 Redis·MySQL을 프로세스 안으로 넣은 번들 하나로 올린다

- 상태: accepted
- 날짜: 2026-10-18
- 관련: [ADR-0004](0004-redis-integration-test-harness.md) · [ADR-0005](0005-flyway-compatible-migration-runner.md) · [ADR-0006](0006-github-actions-ghcr-arm64-single-host.md)

## 맥락

서버를 OCI 단일 호스트(ADR-0006, compose로 backend·Redis·MySQL·Caddy)에서
[Botkeep](https://botkeep.cloud/) 무료(파운더) 플랜으로 옮긴다. 이 플랫폼의 제약은 다음과 같다
(2026-10-18 공개 문서 기준).

- **Docker가 없다.** GitHub 브랜치나 ZIP을 가져와 시작 명령을 실행한다.
- **서버 슬롯이 하나다.** Redis·MySQL도 슬롯을 하나씩 차지하므로 앱과 함께 띄울 수 없다.
- RAM 512MB · 0.5 vCore · 디스크 1GB. 시스템 패키지를 설치할 수 있다고 가정하지 말라고
  안내한다(`redis-server` 바이너리를 기대할 수 없다).

따라서 Redis와 영속 DB를 **Node 프로세스 안으로** 넣어야 한다.

## 결정

1. **Redis → ioredis-mock** (`infra/memoryRedis.ts`, `REDIS_DRIVER=memory`).
   Lua를 fengari로 실행하므로 기존 스크립트를 한 줄도 바꾸지 않는다.
2. **MySQL → Node 내장 `node:sqlite`** (`infra/sqlite.ts`, `DB_DRIVER=sqlite`).
   저장소(`Mysql*Store`)는 그대로 두고, 그들이 쓰는 mysql2 `Pool`의 부분집합만 흉내 낸다.
   의존성이 늘지 않는다. 스키마는 풀을 열 때 `CREATE TABLE IF NOT EXISTS`로 맞추고,
   Flyway 러너는 SQLite 풀을 건너뛴다.
3. **배포물은 esbuild 번들 하나**(`npm run build:botkeep`). 런타임 의존성까지 전부
   품으므로 Botkeep에서 `npm install`이 할 일이 없다. mysql2는 스텁으로 바꿔 끼운다.
4. 기본 드라이버는 그대로 `tcp`·`mysql`이다. 번들만 배너에서 `memory`·`sqlite`를 깐다.
   OCI 경로(compose·이미지·controller)는 지우지 않는다.

### ADR-0004와의 관계

ADR-0004는 ioredis-mock을 **테스트 도구로** 거절했다: 가짜가 검증 대상의 시맨틱을
우리가 상상한 대로 구현하기 때문이다. 이 ADR은 그 판단을 뒤집지 않는다. 방향이 반대다:
진짜 `redis-server` 위의 통합 스위트가 여전히 **명세**이고, ioredis-mock은 그 명세를
통과해야 하는 **구현**이다. CI(`botkeep.yml`)가 같은 스위트를 `REDIS_TEST_DRIVER=mock`으로
돌리고, 번들을 띄워 블랙박스 스위트까지 통과시킨다.

## 확인한 것 (2026-10-18)

- Redis 통합 스위트 30개 파일, 391건이 mock 위에서 통과했다. 실패 1종은 아래 「한계」의 시각 차이다.
- 저장소 스위트(`DB_TEST_DRIVER=sqlite`)는 47건이 통과했다. Flyway 이력 전용 11건은 건너뛴다.
- Lua 원자성(DESIGN.md 원칙 7): 스크립트 500건과 일반 명령 500건을 섞어도 스크립트 도중에
  끼어든 명령이 없었다(`memoryRedis.test.ts`).
- 번들(1.9MB) 위에서 블랙박스 스위트 33건이 통과했다. RSS는 기동 직후 약 91MB, 스위트를
  여섯 번 돌린 뒤 약 139MB에서 멈췄다(힙 상한 96MB 측정, 운영은 128MB).

## 한계

- **재시작하면 방·게스트 세션·진행 중 게임이 사라진다.** Redis에 영속화가 없다. 회원·전적·
  랭킹은 SQLite 파일이라 남는다. DESIGN.md 「재시작 가능성」(마감 시각 재무장)은 이 배포에서
  의미가 없다.
- ioredis-mock은 Lua 실행 중에도 시각이 흐른다. 한 스크립트에서 건 만료끼리 ms 단위로
  어긋날 수 있다(자식 키가 방 키보다 몇 ms 늦게 사라진다). 그 정밀도를 보는 단언 2건은 mock
  모드에서 건너뛴다(`redisClockFrozenInLua`).
- ioredis-mock은 만료 키를 **다시 조회할 때만** 지운다. 그대로 두면 아무도 보지 않는 방 키가
  쌓이므로 `memoryRedis.ts`가 만료를 건 키를 기억했다가 60초마다 회수한다.
- SQLite는 커넥션 하나다. 모든 질의와 트랜잭션이 잠금 하나를 차례로 잡는다(`FOR UPDATE`보다
  강하다). 질의는 동기라 이벤트 루프를 잠깐 막지만, 기록은 게임 종료와 로그인에서만 일어난다.
- 기존 MySQL 데이터는 옮기지 않는다. 필요해지면 네 테이블을 덤프해 같은 열 이름으로 넣으면
  된다(시각은 ISO 8601 UTC 문자열).

## 검토한 대안

- **`redis-server` 바이너리 동봉**: 플랫폼의 아키텍처·libc를 알 수 없고, 시스템 패키지를
  가정하지 말라는 안내와 충돌한다.
- **외부 무료 관리형 DB(Upstash·TiDB Serverless 등)**: 코드 변경은 0이지만 WS 명령마다 Lua
  왕복이 인터넷을 건넌다. 게임 지연이 직접 늘고, 외부 계정이 하나 더 생긴다.
- **Botkeep의 Redis·MySQL 슬롯**: 무료 플랜의 슬롯이 하나라 앱이 들어갈 자리가 없다.
- **저장소를 SQLite 전용으로 다시 쓰기**: 결과는 같고 diff만 크다. mysql2 `Pool` 부분집합
  흉내가 저장소와 기존 테스트를 그대로 살린다.
