# ADR-0006: 배포는 GitHub Actions → GHCR → OCI ARM64 단일 호스트로 옮긴다

- 상태: accepted
- 날짜: 2026-08-14

## 맥락

Phase 5는 운영을 backend-java에서 Node로 넘기는 단계다. 그런데 넘길 **슬롯 자체가
바뀌었다** — 대상 호스트와 CI가 함께 교체된다.

기존 파이프라인(루트 `Jenkinsfile`)이 그대로 쓸 수 없는 이유:

- SSAFY가 제공한 Jenkins 호스트에 묶여 있다. 변경 감지가
  `backend-java/**`·`deploy/**`·`Jenkinsfile`에 **하드코딩**돼 있어 `backend/**`
  (Node)는 애초에 CI/CD에 연결되어 있지 않다. env 파일 경로
  (`/infra/app/.env.{main|dev}`)와 외부 도커 네트워크(`app-network`,
  `app-{main,dev}-network`)도 그 호스트의 사실이다.
- 파이프라인이 **백엔드 테스트를 돌리지 않는다**(`./gradlew bootJar -x test`).
  Node로 옮기면 `npm test`를 넣을 자리가 새로 필요하고, 그 테스트는 진짜 Redis와
  진짜 MySQL을 요구한다([ADR-0004](0004-redis-integration-test-harness.md) ·
  [ADR-0005](0005-flyway-compatible-migration-runner.md)).
- 배포와 프론트 Vercel 배포가 한 파일에 얽혀 있다 — 백엔드만 떼어 옮길 수 없다.

새로 확정된 운영 환경(사용자 결정, 2026-08-14):

| 항목 | 값 |
|---|---|
| 호스트 | Oracle Cloud **Always Free**, Ampere A1, 2 OCPU / 12GB, RUNNING |
| 아키텍처 | **linux/arm64 (aarch64)** — x86 이미지가 돌지 않는다 |
| 부하 | 상시 동접 50명, 방 10~20개 |
| Redis · MySQL | **같은 호스트** |
| coturn/TURN | **배포하지 않는다** — 음성은 STUN-only(`YORR_VOICE_TURN_SECRET` 미설정 시 코드가 자동으로 그 모드다) |
| 빌드 위치 | **배포 대상 서버에서 빌드하지 않는다** |

마지막 줄이 특히 제약이다. 2 OCPU / Always Free에서 `npm ci` + `tsc`를 돌리면
그 시간 동안 실서비스가 같은 CPU를 나눠 쓴다. 게임 서버는 라운드 마감 타이머가
25초+1초 유예로 돌아가므로 빌드 부하가 곧 판정 지연이다.

## 결정

**GitHub Actions에서 linux/arm64 이미지를 만들어 GHCR에 push하고, 호스트는 pull만
한다. 스택 전체(backend · Redis · MySQL · TLS 프록시 · 백업)는 `deploy/compose.yaml`
하나가 소유한다.**

### 1. CI: Jenkins → GitHub Actions (`.github/workflows/backend.yml`)

- 잡 세 개: `verify`(check·typecheck·test·build) · `compose`(compose 문법) ·
  `image`(arm64 빌드, main push에만 GHCR push). `image`는 `needs: [verify]`다 —
  테스트가 초록이 아닌 커밋의 이미지는 레지스트리에 올라가지 않는다. 그래서
  검사와 배포 이미지를 **두 워크플로로 나누지 않았다**(`workflow_run`으로는 이
  게이트를 단단히 걸 수 없다).
- `verify`는 **`redis-server` 바이너리를 apt로 설치**하고 `REDIS_TEST_REQUIRED=1`을
  켠다. service container + `REDIS_TEST_URL`이 아니라 바이너리인 이유는 ADR-0004의
  기본 경로가 "테스트 파일마다 유닉스 소켓 인스턴스 하나"이기 때문이다 — 공유
  Redis 하나에 vitest의 병렬 파일들이 `FLUSHALL`을 걸면 서로를 깬다.
- `verify`는 **`mysql:8.0` service container**를 붙이고
  `MYSQL_TEST_URL`·`MYSQL_TEST_REQUIRED=1`을 켠다. 하네스가 테스트마다
  `yorr_test_<random>` 스키마를 CREATE/DROP하므로 root 자격이 필요하다.
  이 자리가 **MySQL 통합 테스트 45건이 처음으로 실제로 도는 곳**이다(지금까지
  `MYSQL_TEST_URL` 부재로 전부 skip이었고 SQL 문법조차 실행된 적이 없다).
- PR에서도 `image` 잡이 돈다 — push만 하지 않는다. Dockerfile 회귀를 배포
  시점이 아니라 리뷰 시점에 본다.

### 2. arm64 이미지를 x86 러너에서 **에뮬레이션 없이** 만든다

`backend/Dockerfile`은 `npm ci`·`tsc`·`npm ci --omit=dev`를 전부
`--platform=$BUILDPLATFORM` 스테이지에서 끝내고, 최종 arm64 스테이지에는
**`RUN`이 한 줄도 없다**(COPY·ENV·USER·EXPOSE·HEALTHCHECK·CMD뿐). arm64 명령이
실행되지 않으므로 QEMU가 개입할 일이 없다.

이것이 성립하는 근거는 취향이 아니라 의존성 트리의 사실이다(2026-08-14 확인):

- 런타임 트리 73개 패키지에 **네이티브 애드온·아키텍처 게이트(`cpu`/`os`)·
  install 스크립트가 하나도 없다.** fastify · ioredis · mysql2 · ws · zod는 전부
  순수 JS다. `ws`의 `bufferutil`·`utf-8-validate`는 optional peer이고 lockfile에
  들어 있지 않으므로 설치되지 않는다.
- 반대로 **빌드 도구는 네이티브다**: `typescript@7`은 Go로 짠 tsgo이고
  (`@typescript/typescript-linux-{x64,arm64}`), biome·rolldown·esbuild도 플랫폼별
  바이너리를 쓴다. 그래서 컴파일 스테이지를 러너의 네이티브 아키텍처에 두는 것이
  느려서가 아니라 **맞아서** 하는 선택이다.
- 이 전제는 Dockerfile이 매 빌드마다 검사한다: `prod-deps` 스테이지가
  `node_modules`에서 `*.node`를 찾으면 빌드를 실패시킨다. 언젠가 네이티브
  의존성이 들어와도 "arm64 호스트에서만 죽는 이미지"가 조용히 나가지 않는다.

베이스는 `node:22-bookworm-slim`(glibc)이다. alpine이면 위 네이티브 **빌드
도구**들의 musl 호환에 기대야 하는데, 이 환경에 Docker 데몬이 없어 실제로 확인할
수 없었다. 12GB 호스트에서 이미지 100MB 차이는 그 불확실성을 살 값이 아니다.

### 3. 배포는 **사람이 시작한다** (자동 배포를 걸지 않는다)

워크플로는 이미지까지만 만든다. 호스트에서 `docker compose pull && up -d backend`를
실행하는 것은 운영자다.

이것은 게으름이 아니라 [DESIGN.md](../../DESIGN.md) 원칙 8의 직접적인 결과다.
WS 구독·라운드 마감 타이머·방 폐쇄 예약·오프라인 카운터·주간 랭킹 캐시가 전부
**프로세스 인메모리**다. 따라서:

- **인스턴스를 2대로 늘릴 수 없다.** 두 프로세스가 서로의 구독을 모르므로
  브로드캐스트가 반쪽이 되고 마감 타이머가 두 번 발화한다. 로드밸런서 뒤에
  두는 것도 sticky session으로 가려질 뿐 재접속·퀵매치가 깨진다.
- 그래서 **무중단 롤링 배포가 원리적으로 불가능하다.** 새 컨테이너를 띄우고
  트래픽을 옮기는 방식은 두 인스턴스가 공존하는 순간을 요구한다.
- **배포는 진행 중인 게임을 끊는다.** 재시작하면 방 상태는 Redis에 살아 있지만
  소켓이 전부 끊기고, 인메모리 라운드 마감 타이머는 유실된다. 부팅 시
  `closeUnrecoverableGamesOnStartup`이 이어갈 수 없는 PLAYING 방을 **폐쇄**하는
  것이 현재의 방어다 — 즉 "게임이 중단된다"가 버그가 아니라 설계된 동작이다.
- 남는 완화책은 **시각 선택**뿐이다. `main`에 머지될 때마다 자동으로 배포하면
  누군가의 야추 마지막 라운드가 끊길 확률을 CI 트리거에 맡기는 셈이다. 사람이
  한가한 시간을 골라 누른다.

`main` 태그가 "지금 배포 가능한 것", `sha-<커밋>` 태그가 롤백 대상이다. 롤백은
`BACKEND_IMAGE`를 sha 태그로 바꿔 `up -d backend`.

### 4. compose가 스택 전체를 소유한다

기존 `deploy/compose.yaml`은 backend 서비스 하나만 두고 Redis·MySQL·리버스 프록시를
**외부 네트워크에 이미 있는 것으로 전제**했다. 새 호스트에는 없다. 그래서
`backend` · `redis` · `mysql` · `mysql-backup` · `caddy` · `migrate`(프로필)를
모두 이 파일에 둔다.

유지한 계약:

- 서비스 이름 **`backend`**(rename 금지 — Jenkins 시절부터의 계약이고 바꿀 이유가 없다)
- 설정은 **`env_file`로 주입**, `BACKEND_ENV_FILE`로 경로 지정
- **backend는 포트를 공개하지 않는다** — 바깥에서 오는 길은 프록시뿐이다

바꾼 계약과 이유:

- 외부 `app-network`/`app-{main,dev}-network` → 이 파일이 만드는 `edge`·`internal`
  두 네트워크. caddy는 `internal`에 붙지 않으므로 DB에 닿을 수 없다.
- main/dev 두 슬롯 → **단일 환경**. Always Free 인스턴스 하나에 두 슬롯을 올리면
  dev 부하가 운영 게임의 타이머를 밀어낸다. dev가 필요해지면 별도 인스턴스다.
- `REDIS_HOST`·`DB_HOST`·`DB_PORT`·`DB_URL`은 compose의 `environment`가
  **`env_file`을 덮어쓴다.** "설정은 전부 env_file"에서 벗어나는 유일한 지점이고
  의도한 것이다: 옆 서비스의 좌표는 운영자의 설정이 아니라 이 파일이 정하는
  토폴로지의 성질이다. 이 override 덕에 구 호스트의 `.env`를 그대로 가져와도
  (그 파일의 `DB_URL`은 `localhost`를 가리킨다) 컨테이너가 옆 서비스를 찾는다.
  `DB_URL`을 비우는 것이 특히 중요하다 — 값이 있으면 `env.ts`가 `DB_HOST`를 덮는다.
- **TLS를 스택 안으로 들인다.** 프론트는 Vercel(`https://yorr.site`)이고 HTTPS
  페이지에서 `ws://`는 브라우저가 차단한다. 즉 TLS는 선택이 아니다. Caddy가
  도메인 하나에 대해 자동 발급·갱신하고 WebSocket Upgrade를 그대로 통과시킨다.
  Caddyfile을 두지 않고 `caddy reverse-proxy` 서브커맨드를 쓴 것은 설정이 실제로
  한 줄이기 때문이다(경로 분기가 필요해지면 Caddyfile로 옮긴다).
- **여는 포트는 80/443뿐이다.** coturn을 배포하지 않기로 했으므로 UDP 릴레이
  포트 범위가 필요 없다. 이것이 Always Free 인스턴스에서 방화벽 설정을 크게
  단순화한다.

### 5. MySQL 데이터 볼륨 + 일일 논리 백업

`mysql-data` 볼륨에 **실사용자 계정·전적·주간 랭킹**이 있다. 볼륨 하나가 유일한
사본인 상태를 만들지 않기 위해 `mysql-backup` 사이드카가 24시간 주기로
`mysqldump --single-transaction --databases`를 `${BACKUP_DIR}`에 쓰고
`BACKUP_RETENTION_DAYS`(기본 14일)보다 오래된 것을 지운다.

cron 앵커가 아니라 "기동 직후 한 번 + 24시간 주기"인 이유는 `date -d` 같은 GNU
확장에 의존하지 않기 위해서다(이 환경에 Docker가 없어 mysql:8.0 이미지의 셸
도구를 확인할 수 없었다 — 확인 없이 쓴 기능이 조용히 실패하면 백업이 없는데
있다고 믿는 최악의 상태가 된다). 정해진 시각이 필요하면 이 서비스를 지우고
호스트의 systemd timer에서 같은 명령을 부른다.

**같은 호스트의 덤프는 백업이 아니다.** 호스트를 잃으면 함께 잃는다.
`${BACKUP_DIR}`을 호스트 밖으로 복사하는 것까지가 백업이며, 그것은 운영자의 일로
남는다(operations.md의 체크리스트).

### 6. `Jenkinsfile`은 지우지 않고 남긴다 (전환 완료까지)

지금 지우면 두 가지가 함께 사라진다:

1. **backend-java 배포 경로.** 전환이 끝나기 전까지 SSAFY 호스트의 Java 백엔드가
   운영이고 롤백 대상이다. Node 쪽에 문제가 생겼을 때 되돌아갈 길을 먼저 끊는 것은
   순서가 거꾸로다.
2. **프론트 Vercel 배포.** `Jenkinsfile`의 마지막 두 스테이지가 프론트 검사와
   `vercel deploy --prod`다. 이것은 Phase 5의 백엔드 전환과 아무 관계가 없는데
   같은 파일에 얽혀 있다. 지우면 프론트 배포가 조용히 멈춘다.

그래서 이번 변경에서는 파일 맨 위에 **전환 상태를 적은 주석만 추가**하고 동작은
건드리지 않는다. 삭제는 PLANS.md Phase 5의 마지막 항목("backend-java 제거 +
낡은 문서 정리 — 별도 PR")에서, 프론트 배포를 GitHub Actions나 Vercel Git 연동으로
옮긴 뒤에 한다.

## 검토한 대안

- **Jenkins를 유지하고 스테이지만 Node로 갈아탄다**(PLANS.md가 원래 적어 둔 안).
  변경 지점이 changeset 5곳 + 빌드 스테이지 + `docker build` 대상뿐이라 diff는
  작다. 기각 이유는 diff 크기가 아니라 **호스트가 바뀌었다**는 것이다: 그
  Jenkins는 SSAFY 인프라 위에 있고 새 OCI 인스턴스에 배포할 자격도 네트워크
  경로도 없다. Jenkins를 OCI에 새로 세우는 것은 2 OCPU / 12GB의 상당 부분을 CI에
  내주는 선택이고(JVM + 워크스페이스), 그러면 "배포 대상 서버에서 빌드하지
  않는다"는 결정과 정면으로 부딪친다. GitHub Actions는 저장소가 이미 GitHub에
  있고 러너 비용이 0이다.
- **서버에서 빌드한다**(`git pull && docker compose build && up -d`). 레지스트리도
  인증도 필요 없어 가장 단순하다. 기각: ① 2 OCPU를 빌드와 실서비스가 나눠 쓰는
  동안 라운드 마감 타이머(25s+1s)가 밀린다 ② 빌드가 실패하면 배포 가능한 이미지가
  아예 없는 상태로 남는다(레지스트리에 있으면 이전 이미지로 즉시 되돌린다)
  ③ 어떤 커밋이 돌고 있는지가 서버의 작업 트리 상태에 달려 있다 — 이미지 태그가
  주는 재현성을 잃는다.
- **매니지드 DB**(OCI MySQL HeatWave · Autonomous · 매니지드 Redis). 백업·패치·
  가용성을 남에게 맡기는 것이 정론이다. 기각: OCI Always Free 한도에 매니지드
  MySQL이 들어 있지 않다(HeatWave 무료 티어는 리전·형상 제약이 있고 Always Free
  A1 인스턴스와 별개 자원이다). 이 프로젝트에서 **비용 0이 요구사항**이고, 같은
  호스트의 컨테이너 MySQL은 50 동접·방 20개 규모에 과하지 않다 — 애초에 게임
  진행 중에는 MySQL을 만지지 않는다(DESIGN.md 원칙 6). 자원이 생기면 다시 연다.
- **GitHub의 ARM 러너(`ubuntu-24.04-arm`)로 네이티브 빌드.** 가장 직관적이고
  런타임 스테이지에 `RUN`을 자유롭게 쓸 수 있다. 기각: 비공개 저장소에서 ARM
  러너는 무료 분에 포함되지 않는다(공개 저장소만 무료). 그리고 위 2번의 근거대로
  **arm64에서 실행할 것이 아무것도 없다** — 러너 아키텍처를 바꿔 얻을 것이 없다.
- **QEMU 에뮬레이션으로 arm64 스테이지를 그대로 실행.** `setup-qemu-action` 한
  줄이면 되고 Dockerfile을 단순한 2스테이지로 유지할 수 있다. 기각: 에뮬레이션
  아래 `npm ci`는 수 분 단위로 느려지고(모든 파일 I/O가 통역된다), 실패 모드가
  헷갈린다. 다만 워크플로에 `setup-qemu-action`은 **보험으로 남겨 둔다** —
  누군가 런타임 스테이지에 `RUN`을 추가했을 때 "exec format error"라는 알기 어려운
  실패 대신 느리게라도 성공하게 한다.
- **Kubernetes / Docker Swarm.** 원칙 8(인메모리 상태)이 replica 1을 강제하므로
  오케스트레이터가 줄 것이 롤링 업데이트인데 그것을 쓸 수 없다. 남는 것은 YAML
  분량뿐이다.
- **compose에 backend만 남기고 Redis·MySQL은 호스트에 직접 설치**(apt).
  메모리가 조금 덜 들고 백업 도구가 익숙하다. 기각: 버전·설정이 호스트 상태에
  숨고, 재구축(인스턴스를 다시 만들 때)이 문서 의존이 된다. compose 파일 하나가
  스택의 정본인 편이 낫다.
- **coturn/TURN을 함께 배포.** 대칭 NAT 뒤의 사용자에게 음성이 되게 하려면
  릴레이가 필요하다. 이번에는 배포하지 않기로 사용자가 결정했고, 그 결정이
  방화벽을 크게 단순화한다(UDP 포트 범위 없음). 코드는
  `YORR_VOICE_TURN_SECRET`이 비면 자동으로 STUN-only다(1.7) — 되돌리는 데 코드
  변경이 필요 없으므로 나중에 별도 결정으로 다룰 수 있다.
- **`main` push마다 자동 배포**(워크플로에서 SSH). 편하다. 기각: 위 3번 —
  배포가 진행 중 게임을 끊는다. 게다가 배포 키를 GitHub Secrets에 두면 저장소
  쓰기 권한이 곧 운영 호스트 셸 권한이 된다.

## 결과

- **`backend/**`가 처음으로 CI에 연결된다.** 지금까지 어떤 파이프라인도 Node
  백엔드를 검사하지 않았다.
  - ⚠️ **`npm run check`는 현재 `main`에서 실패한다**(biome 2.5.8 기준 6 errors +
    1 warning, 그리고 `biome.json`의 `$schema`가 2.5.5로 적혀 있어 버전 불일치
    진단). 이 워크플로를 넣는 PR은 그것을 먼저 정리해야 초록이 된다
    (`npm run format` + `biome migrate`). 이 ADR은 그것을 고치지 않는다 —
    `src/**`·`biome.json`은 이 작업의 소유 범위 밖이다.
  - ⚠️ **MySQL 통합 테스트 45건이 처음으로 실제로 돈다.** 한 번도 실행된 적이
    없으므로 SQL 문법·컬럼 이름 수준의 실패가 여기서 처음 드러날 수 있다.
    그것이 이 자리를 만든 목적이다.
- **빈 MySQL 위에서는 backend가 뜨지 못한다.** `verifyMigrations`는 읽기 전용이고
  밀린 마이그레이션이 있으면 exit 1이다(ADR-0005의 의도). 그런데 `runMigrations`에는
  **진입점이 없다**(npm 스크립트도 CLI도 없고 테스트만 부른다). 새 호스트의 첫
  기동을 위해 compose에 `migrate` 서비스(`profiles: ["bootstrap"]`)를 두어 이미지
  안의 `dist`로 `runMigrations`를 부른다.
  - 새 호스트의 MySQL은 backend-java와 공유하지 않으므로 ADR-0005의 "전환기
    스키마 동결"이 여기를 묶지 않는다.
  - 다만 **우선순위는 기존 데이터 이관이다**: 구 호스트의 덤프를 복원하면
    `flyway_schema_history`가 함께 오고(V1·V2는 바이트 단위로 같은 파일이라
    체크섬이 맞는다) `migrate`가 필요 없어진다. 실사용자 전적·랭킹을 새 호스트에서
    빈 DB로 시작하는 것은 **데이터 유실**이다.
  - `package.json`에 `migrate` 스크립트를 넣는 것이 옳은 방향이다(이 작업의 소유
    범위 밖 — 별도 티켓).
- **종료 훅이 실제로 도는 것을 확인했다**(2026-08-14, PID 네임스페이스로 검증):
  - `CMD ["node", "dist/main.js"]` — node가 PID 1이고 `process.on('SIGTERM')`
    핸들러가 등록돼 있으면 핸들러가 발화한다.
  - `npm start`로 감싸면 **깨진다.** npm은 SIGTERM을 받고 143으로 죽지만 자식
    node에 전달하지 않아, 자식이 살아남고 종료 훅이 돌지 않는다(실측).
  - 남은 틈: `main.ts`는 `createServer`·`verifyMigrations`를 await한 **뒤에**
    핸들러를 등록한다. 그 사이(기동 수 초)의 SIGTERM은 PID 1 기본 동작이 없어
    무시되고 `docker stop`이 10초 뒤 SIGKILL한다. 기동 중에만 해당한다.
- **`db/migration/`은 런타임 이미지의 필수 산출물이다.** `tsc`는 SQL을 복사하지
  않고, `discover.ts`가 `dist/infra/migrations/`에서 `../../../db/migration/`을
  읽는다. 빠지면 ENOENT → exit 1이다(Dockerfile이 `COPY db ./db`로 명시).
- **기동 실패가 exit≠0인 것을 확인했다.** MySQL 없이 `node dist/main.js`를 돌리면
  `ECONNREFUSED` 로그와 함께 exit 1이다 — `sleep 15` + Running 확인 방식의 배포
  검증에 걸린다(operations.md의 계약 그대로).
- 운영자에게 남는 수동 작업(operations.md에 체크리스트로 있다): OCI Security
  List/NSG에 80·443 허용, 도메인 A/AAAA 레코드, `deploy/.env` 배치, GHCR 로그인
  (비공개 패키지면 read:packages PAT), 구 MySQL 데이터 이관, `${BACKUP_DIR}`
  호스트 밖 복사, 프론트 `VITE_WS_URL`·`VITE_API_BASE_URL`을 새 도메인으로 교체.
- `deploy/.env` 하나가 compose 보간과 backend `env_file`을 겸한다. 그 결과
  `MYSQL_ROOT_PASSWORD`가 backend 컨테이너 환경에도 보인다. 파일을 둘로 쪼개면
  `DB_PASSWORD`가 두 곳에 중복돼 **어긋날 때 MySQL 사용자와 앱이 다른 비밀번호를
  쓰는 조용한 실패**가 생기는데, 같은 호스트에서 그 파일을 읽을 수 있는 사람이
  컨테이너 환경도 읽을 수 있으므로 중복 쪽 위험이 더 크다고 판단했다.
  쪼개고 싶으면 `BACKEND_ENV_FILE`로 다른 경로를 주면 된다.
- **단일 인스턴스 제약이 문서에 남는다.** 수평 확장·무중단 배포가 필요해지는
  시점은 "WS 구독과 타이머를 프로세스 밖으로 옮긴다"는 별도 ADR의 시점이다.
  그 전에는 인스턴스를 늘리려는 시도 자체가 설계 위반이다.
