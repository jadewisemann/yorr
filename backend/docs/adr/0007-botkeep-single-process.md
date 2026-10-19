# ADR-0007: Botkeep에 Node 프로세스 하나로 올린다 — Redis·MySQL을 프로세스 안으로

- 상태: accepted
- 날짜: 2026-10-18
- 대체: [ADR-0004](0004-redis-integration-test-harness.md) · [ADR-0005](0005-flyway-compatible-migration-runner.md) · [ADR-0006](0006-github-actions-ghcr-arm64-single-host.md)

## 맥락

서버를 OCI 단일 호스트(ADR-0006, compose로 backend·Redis·MySQL·Caddy·Alloy)에서
[Botkeep](https://botkeep.cloud/) 무료(파운더) 플랜으로 옮긴다. 이 플랫폼의 제약은 다음과 같다
(2026-10-18 공개 문서 기준).

- **Docker가 없다.** GitHub 브랜치나 ZIP을 가져와 시작 명령을 실행한다.
- **서버 슬롯이 하나다.** Redis·MySQL도 슬롯을 하나씩 차지하므로 앱과 함께 띄울 수 없다.
- RAM 512MB · 0.5 vCore · 디스크 1GB. 시스템 패키지를 설치할 수 있다고 가정하지 말라고
  안내한다(`redis-server` 바이너리를 기대할 수 없다).

운영 데이터 이전은 요구 사항이 아니다(회원·전적을 새로 시작해도 된다고 확인했다).

## 결정

1. **Redis → `MemoryRedis`**(`infra/memoryRedis.ts`). 코드가 실제로 쓰는 Redis 명령만
   동기식으로 구현하고, ioredis와 같은 이름의 비동기 메서드를 내놓는다. 저장소 코드는 Redis를
   쓰던 모양 그대로다. `ioredis`는 지운다.
2. **Lua → `AtomicScript`.** 스크립트 18개를 같은 조건 순서의 동기 JS 함수로 옮겼다. 도중에
   `await`가 없으므로 Node의 단일 스레드에서 다른 명령이 끼어들 수 없다 — 이것이 DESIGN.md
   원칙 7(원자성)의 새 근거다.
3. **MySQL → Node 내장 `node:sqlite`**(`infra/sqlite.ts`). 저장소가 쓰던 `Pool` 모양
   (`query`·`getConnection`·트랜잭션)만 구현한다. 스키마는 파일을 처음 열 때
   `CREATE TABLE IF NOT EXISTS`로 맞춘다. `mysql2`·Flyway 호환 러너·`db/migration`을 지운다.
4. **배포물은 esbuild 번들 하나**(`npm run build:botkeep`). 런타임 의존성(fastify·ws·zod)을
   전부 품어 Botkeep에서 `npm install`이 할 일이 없다. CI가 번들을 패널과 같은 명령으로 띄워
   시험한 뒤 `botkeep` 브랜치에 커밋한다.
5. **OCI 경로를 지운다** — Dockerfile·compose·Caddy·controller·systemd·Alloy·배포 리허설과
   해당 워크플로. 되돌릴 일이 생기면 git 이력에서 꺼낸다.

## 검토한 대안

- **ioredis-mock(fengari로 Lua 실행)**: 첫 시도였다. 기존 스크립트를 한 줄도 바꾸지 않고
  Redis 통합 스위트 391건이 통과했다. 그러나 Lua 호출마다 상태를 새로 만들어 **빈 스크립트
  한 번에 1.2ms**(일반 명령 0.002ms), **2,000번에 RSS 262MB**가 늘었다. 0.5 vCore에서 GC가
  CPU를 잡아먹는 구조라 걷어 냈다. Lua 실행 중에 시각이 흘러 한 스크립트 안의 만료가 ms 단위로
  어긋나는 문제도 있었다.
- **`redis-server` 바이너리 동봉**: 플랫폼의 아키텍처·libc를 알 수 없고, 시스템 패키지를
  가정하지 말라는 안내와 충돌한다.
- **외부 무료 관리형 DB(Upstash·TiDB Serverless 등)**: 코드 변경은 0이지만 WS 명령마다 원자적
  전이가 인터넷을 건넌다. 게임 지연이 직접 늘고 외부 계정이 하나 더 생긴다.
- **Botkeep의 Redis·MySQL 슬롯**: 무료 플랜의 슬롯이 하나라 앱이 들어갈 자리가 없다.
- **MySQL 경로를 남겨 두고 드라이버로 고르기**: 처음엔 그렇게 했다. 두 경로를 모두 시험해야
  하고 번들에서 mysql2를 스텁으로 빼야 했다. 돌아갈 계획이 없어 지웠다.

### ADR-0004와의 관계

ADR-0004는 "가짜 Redis는 검증 대상의 시맨틱을 우리가 상상한 대로 구현한다"며 인메모리 페이크를
거절했다. 그 경고는 여전히 맞다. 달라진 것은 **가짜가 곧 운영 구현이 되었다**는 점이다 —
테스트와 운영이 같은 `MemoryRedis`를 쓰므로 "테스트는 통과하는데 운영 Redis는 다르게 동작한다"는
틈이 사라졌다. 남는 위험은 우리가 Redis 시맨틱을 잘못 옮긴 경우인데, 옮기기 전에 진짜
`redis-server` 위에서 초록이던 통합 스위트 전체가 그대로 통과하는 것으로 확인했다.

## 확인한 것 (2026-10-18)

- 단위·통합 1,111건 통과, **건너뜀 0건**(이전에는 Redis·MySQL 서버가 없으면 11~49건을 건너뛰었다).
  Lua 실행 중 시각이 흐르던 문제가 사라져 ioredis-mock 시절에 건너뛰던 TTL 정밀도 단언 2건도
  되살렸다.
- 원자성: 스크립트 500건과 일반 명령 500건을 섞어도 스크립트 도중에 끼어든 명령이 없다
  (`memoryRedis.test.ts`).
- 블랙박스 스위트 35건(장애 주입·누수 검사 포함) 통과, 번들 대상 33건 통과.
- 실제 브라우저 E2E(`frontend/e2e/real`) 5건이 번들을 상대로 통과, 새어 나온 핸들러 예외 0건.
- 번들 1.08MB. RSS는 기동 직후 79MB, 블랙박스 스위트를 여섯 번 돌린 뒤 95MB(힙 상한 128MB).
- 커버리지 바닥을 하나로 합쳐 올렸다(statements 92.6 · branches 84.7 · functions 92 · lines 94.7).

## 결과와 한계

- **저장소는 스냅샷으로 재시작을 넘긴다**(2026-10-19 갱신, 코드 리뷰 지적). 처음에는 영속화가
  없어 재시작마다 방·세션이 사라졌고, 부팅 재무장(`startupResume`)이 빈 저장소만 보는 죽은 코드가
  됐다. 지우는 대신 `infra/storeSnapshot.ts`가 정상 종료와 60초마다 저장소를 파일 하나에 원자적으로
  쓰고(임시 파일 → rename) 기동 때 읽게 해 재무장을 되살렸다. 비정상 종료면 마지막 스냅샷 이후만
  잃는다(Redis RDB와 같은 절충). 손상된 스냅샷은 지우지 않고 옆으로 치운 뒤 빈 저장소로 뜬다.
- **키 수 상한**(`DEFAULT_MAX_KEYS` 10만). 인증 없는 게스트 생성을 반복해도 힙(128MB)을 다 쓰지
  못하게, Redis `maxmemory` + `noeviction`처럼 새 키를 거절한다.
- 단일 프로세스·단일 인스턴스다(DESIGN.md 원칙 8이 더 단단해졌다). 무중단 교체는 없다.
- SQLite는 커넥션 하나다. 모든 질의·트랜잭션이 잠금 하나로 직렬화되고, 질의가 동기라
  이벤트 루프를 잠깐 막는다. 기록이 게임 종료·로그인에서만 일어나 문제가 되지 않는다.
- 장애 주입(`test/faults/faultyRedis.ts`)은 그대로 쓴다. 원자적 스크립트 한 번이 명령 하나로 센다.
- 메트릭(`/actuator/prometheus`)은 남아 있지만 지금은 아무도 긁지 않는다.
- `Redis*Store`·`redis` 같은 이름은 그대로 둔다 — "Redis 명령 모양의 저장소"라는 뜻으로 읽는다.
  바꾸면 diff만 커지고 얻는 것이 없다.
