# ADR-0004: Redis 통합 테스트는 로컬 redis-server 프로세스로 띄운다

- 상태: accepted
- 날짜: 2026-08-14

## 맥락

방·세션·점수의 계약은 대부분 Redis 안에 있다 — Lua 스크립트의 원자성과 반환
코드, TTL 슬라이딩, 동시 제출 경합. 이것들은 **모킹으로 검증할 수 없다**
(가짜 Redis는 우리가 검증하려는 바로 그 시맨틱을 우리가 상상한 대로 구현한다).
backend-java는 Testcontainers(`redis:7.4-alpine`)로 실제 Redis를 띄웠고,
PLANS.md 1.1은 Node 쪽 대응 방식을 정하도록 남겨 두었다.

제약:

- 저장소의 Jenkins 파이프라인은 백엔드 테스트를 실행하지 않는다(`-x test`).
  즉 지금 이 하네스의 1차 사용처는 **개발자 로컬과 에이전트 환경**이다.
- 그럼에도 Phase 5에서 `npm test`를 파이프라인에 넣을 때 그대로 쓸 수 있어야
  한다.
- vitest는 테스트 파일을 병렬로 돌린다. 공유 Redis 하나에 `FLUSHALL`을 거는
  방식은 파일 간 간섭을 만든다.

## 결정

**테스트 파일마다 로컬 `redis-server`를 유닉스 소켓으로 하나씩 띄운다.**
(`test/redisHarness.ts`)

- `useRedis()`가 `beforeAll`에서 `redis-server --port 0 --unixsocket <tmp>/r.sock
  --save '' --appendonly no`를 spawn하고, `afterAll`에서 죽인다.
  포트를 열지 않으므로 포트 충돌이 없고, 파일마다 인스턴스가 달라 병렬 실행과
  양립한다. 매 테스트 전 `FLUSHALL`은 Java의 `@BeforeEach flushAll`과 같다.
- `REDIS_TEST_URL`이 있으면 spawn 대신 그 서버에 붙는다 — CI의 service
  container나 개발자의 기존 Redis를 쓰는 탈출구.
- `redis-server`도 `REDIS_TEST_URL`도 없으면 통합 스위트를 **건너뛴다**
  (`describeRedis`). 단 `REDIS_TEST_REQUIRED=1`이면 건너뛰지 않고 실패한다 —
  CI가 "조용히 초록"이 되는 것을 막는 스위치다. 파이프라인에 백엔드 테스트를
  넣을 때 이 변수를 켠다(operations.md).

## 검토한 대안

- **testcontainers-node**: Java와 같은 방식이고 이미지 버전을 고정할 수 있다.
  하지만 Docker 데몬이 필요하다 — 컨테이너 안에서 도는 개발·에이전트 환경에서
  DinD 설정이 필요해지고, 기동이 초 단위로 느리다. 여기서 검증하는 것은 Redis
  자체가 아니라 우리 스크립트의 시맨틱이라 이미지 고정의 이득이 크지 않다.
  Redis 버전 차이가 실제로 문제를 일으키면 이 ADR을 다시 연다.
- **테스트 전용 docker compose**: 개발자가 테스트 전에 뭔가를 띄워 둬야 한다는
  뜻이다. `npm test` 한 줄로 안 도는 하네스는 결국 안 돌게 된다.
- **인메모리 페이크(ioredis-mock 등)**: Lua·TTL·동시성이 전부 흉내다. 검증
  대상을 검증 도구가 흉내 내는 구조라 채택하지 않는다.
- **공유 인스턴스 + 키 프리픽스 격리**: 프리픽스를 실수로 빠뜨리면 조용히
  깨지고, `FLUSHALL`·`SCAN room:*` 같은 전역 명령을 쓰는 테스트(부팅 재무장·고아 상태 스위퍼)
  를 쓸 수 없다.

## 결과

- 테스트 하네스는 `test/`(빌드 대상 밖)에 둔다. `tsconfig.json`의 typecheck
  범위에는 포함하고 `tsconfig.build.json`은 `src`만 컴파일한다.
- 통합 테스트를 쓰는 스위트는 `describeRedis(...)` + `const redis = useRedis()`
  형태로 시작한다.
- 개발 환경에 `redis-server` 바이너리가 필요하다 — README의 준비물에 기재.
