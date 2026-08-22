# 운영 (환경변수 · 모니터링 · 배포 계약)

> 상위 원칙은 [DESIGN.md](../../DESIGN.md). Java 원본: `application.yaml`,
> `config/`, `monitoring/`. 배포 파이프라인: `.github/workflows/backend.yml`,
> `backend/Dockerfile`, `deploy/compose.yaml`
> ([ADR-0006](../adr/0006-github-actions-ghcr-arm64-single-host.md)).
> 구 Jenkins 파이프라인은 삭제했다(아래 「구 파이프라인은 없다」).
>
> 이 문서는 **지금 동작하는 것**만 기술한다. 배포 파이프라인을 Release 단위
> pull CD로 교체하는 **예정**은 [`deploy/PLAN.md`](../../../deploy/PLAN.md)에
> 있으며, 그쪽 내용이 여기로 오는 시점은 호스트 cutover가 끝난 뒤다.

## 환경변수 (backend-java와 이름 동일 유지)

기본값은 `config/env.ts`(zod 스킴)가 정본이다. **필수 변수는 하나도 없다** —
전부 기본값이 있어 빈 환경에서도 부팅된다(운영에서 빠뜨리면 로컬 기본값으로 뜨는
것이 그 대가다).

| 변수 | 기본값 | 용도 |
|---|---|---|
| `DB_URL` | `""` = 미사용 | MySQL 좌표. **Java가 읽는 것은 이것 하나(JDBC URL)다**(`application.yaml: url: ${DB_URL}`). 값이 있으면 `jdbc:` 접두를 벗겨 파싱해 아래 `DB_HOST`·`DB_PORT`·`DB_NAME`을 **덮어쓴다** — 운영 `.env`가 그대로 재사용된다(4.2에서 정렬 완료). 쿼리 파라미터(`serverTimezone` 등)는 일부러 버린다 |
| `DB_HOST` / `DB_PORT` / `DB_NAME` | `localhost` / `3306` / `yorr` | `DB_URL`이 없을 때 쓰는 쪼갠 좌표. Node·로컬 `.env.example` 전용이며 Java에는 대응이 없다 |
| `DB_USERNAME` / `DB_PASSWORD` | `yorr` / `""` | MySQL 자격. **URL 안의 userinfo보다 이쪽이 이긴다**(Java의 JDBC 프로퍼티와 같은 결론) |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` | Redis |
| `REDIS_PASSWORD` | `""` | Redis |
| `SERVER_PORT` | `8080` | 리슨 포트 |
| `CORS_ALLOWED_ORIGINS` | `https://yorr.site` | REST·WS 공용 허용 출처(콤마 목록). 기본값이 운영 전용인 것이 fail-safe 설계다. **정확 일치**이며 패턴이 아니다 — `allowedOrigins()`가 공백과 끝의 `/`만 정규화한다(브라우저의 `Origin`에는 경로가 없다). 운영에서 실제로 쓰이는 값은 compose가 준다(아래 「공개 주소 네 개」). **소셜 로그인의 복귀 출처 목록도 이것이다**([auth.md](auth.md) 「복귀 출처」) — 새 프론트 주소를 열 때 손댈 곳이 여기 하나인 이유다 |
| `AUTH_FRONTEND_REDIRECT_URI` | `http://localhost:5173/auth/callback` | 로그인 콜백 후 프론트 복귀. 운영은 `https://yorr.site/auth/callback` — compose가 그 값을 기본값으로 준다(아래 「공개 주소 네 개」) |
| `KAKAO_CLIENT_ID` / `KAKAO_CLIENT_SECRET`(선택) / `KAKAO_REDIRECT_URI` | `""` / `""` / localhost 콜백 | 카카오 OAuth. **`.env`에 넣는 것은 자격 두 개뿐이다** — 콜백 주소는 compose가 준다 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | `""` / `""` / localhost 콜백 | 구글 OAuth. 같다 — `.env`에는 자격 두 개만 |

Java에서 `@Value`로만 존재해 yaml에 없는 것(환경으로만 주입) — Node에서는
env.ts에 정식 편입한다(1.7에서 완료). **이름은 제안이 아니라 Java가 실제로 읽는
것을 그대로 쓴다**: Spring relaxed binding이 `yorr.voice.turn.secret`을 읽는
환경변수 이름은 `YORR_VOICE_TURN_SECRET`이다(`.`·`-` → `_`, 대문자). 다른
이름을 쓰면 운영 `.env`가 재사용되지 않는다.

| 변수 (Java 프로퍼티) | 기본값 | 용도 |
|---|---|---|
| `YORR_VOICE_TURN_SECRET` (`yorr.voice.turn.secret`) | `""` = TURN 미제공 | coturn 공유 시크릿 |
| `YORR_VOICE_TURN_HOST` (`yorr.voice.turn.host`) | `""` = TURN 미제공 | TURN 호스트 |
| `YORR_VOICE_STUN_URL` (`yorr.voice.stun-url`) | `stun:stun.l.google.com:19302` | STUN |
| `YORR_VOICE_TURN_TTL_SECONDS` (`yorr.voice.turn.ttl-seconds`) | `600` | 자격 TTL |

테스트 전용 변수(런타임은 읽지 않는다 — [ADR-0004](../adr/0004-redis-integration-test-harness.md)):

| 변수 | 기본값 | 용도 |
|---|---|---|
| `REDIS_TEST_URL` | 없음 = 테스트가 `redis-server`를 직접 띄운다 | 이미 떠 있는 Redis로 통합 테스트를 돌린다 |
| `REDIS_TEST_REQUIRED` | 없음 | `1`이면 Redis가 없을 때 건너뛰지 않고 실패한다. **파이프라인에 `npm test`를 넣을 때 켠다**(Phase 5) |
| `MYSQL_TEST_URL` | 없음 = 마이그레이션 통합 테스트를 건너뛴다 | 이미 떠 있는 MySQL로 마이그레이션 러너 통합 테스트를 돌린다([ADR-0005](../adr/0005-flyway-compatible-migration-runner.md)) |
| `MYSQL_TEST_REQUIRED` | 없음 | `1`이면 MySQL이 없을 때 건너뛰지 않고 실패한다. **파이프라인에 mysql 서비스와 함께 켠다**(Phase 5) |

프로퍼티처럼 동작하는 하드코딩 상수(설정 아님 — 바꾸면 계약 변경):
프로토콜 버전 1, 하트비트 30s/타임아웃 90s, 방 TTL 40분, 빈 방 유예 30s/게임 중
10분, 턴 25s+유예 1s, 오프라인 허용 2턴, 게스트 24h/회원 30d, 스위퍼 5분.

## 부팅 배선 (`server.ts` / `main.ts`)

`createServer`는 **조립만** 한다(DESIGN.md 「코드 구조」). 배선표가 여기 있는 이유는
이 저장소에서 **배선 누락이 반복된 실패 모드**이기 때문이다: 타입이 맞고 빌드·단위
테스트도 통과하는데 런타임에 조용히 아무 일도 일어나지 않는다. 실제로 겪은 다섯 번은
① 봇 라우트가 브로드캐스터를 못 받아 404 ② 게임 모듈 레지스트리가 갈라져 훅 미실행
③ 라운드 타이머가 다른 브로드캐스터를 받아 방송이 허공으로 ④ 퀵매치 presence가 다른
레지스트리라 자동 시작이 영구 거짓 ⑤ 운영 라운드 저장소가 인메모리(재시작마다 진행 중
게임 소실)다. 그래서 **`src/__tests__/serverWiring.test.ts`가 배선 자체를 회귀
테스트로 고정한다** — 판정 기준은 "타입이 맞는가"가 아니라 "배선을 빼면 이 테스트가
깨지는가"다.

### 공유 인스턴스 (새로 만들면 조용히 깨진다)

| 인스턴스 | 받는 쪽 |
|---|---|
| `RoomBroadcaster` | WS 게이트웨이 · 봇 REST · 라운드 타이머·해소기 · 게임 종료 · 야추·듀얼·탁구 모듈 |
| `RoomSessionRegistry` | WS 게이트웨이 · 라운드 타이머(presence) · 게임 종료(markPhase) · 세 게임 모듈 · **퀵매치(자동 시작 조건)** |
| `RealtimeRoomSnapshotService` | WS 게이트웨이 · 봇 REST · 게임 종료 · 재접속 스냅샷 · 세 게임 모듈 |
| `GameModuleRegistry` | WS 게이트웨이(`handleGameMessage`·이탈 훅) · `GameLifecycleService`(REST 시작) |
| `InMemoryRoundDeadlineScheduler` | 라운드 타이머 · 게임 종료(`cancelRoom`) · 듀얼·탁구(상태 `version` 키) |
| `GameCompletionService`(2.7) | 라운드 타이머(`gameCompletion`) · 듀얼 · 탁구 — **전부 `force=true` 경로** |
| `CachingWeeklyRankingRepository`(4.5) | 랭킹 서비스(읽기) · 전적 보관(4.4)의 `rankingCache`(evict) |

- 라운드 상태 저장소는 **`RedisYachtDiceStateStore`**(3.1)다. `InMemoryRoundStateStore`는
  2.4가 남긴 테스트 시드이며, 운영에 두면 재시작마다 진행 중 게임이 사라지는데 타입은
  맞아서 아무 테스트도 깨지지 않는다.
- 4.4의 포트 이름이 4.5의 구현과 다르다(`RankingCacheInvalidator.invalidateAll` ↔
  `WeeklyRankingCacheEvictor.evictAll`) — 배선에 한 줄 어댑터가 있다.
- MySQL을 타는 배선(4.3 프로필·4.4 전적 보관·4.5 랭킹)은 **풀이 lazy라 MySQL 없이도
  조립·기동이 성공한다.** 전적 보관 실패는 2.7이 삼켜 `onArchiveFailure` 로그로 흘리므로
  게임 종료는 그대로 진행된다.

### 등록되는 REST 라우트 (`/api/v1`)

방·게임(1.4) · 음성(1.7) · 조회(2.9 `scores`·`results`·`score-candidates`) ·
프로필(4.3 `users/me`) · 퀵매치(3.5) · 랭킹(4.5) · 소셜 로그인(4.2). 헬스·메트릭은
프리픽스 밖(`/actuator/*`)이다. **등록하지 않으면 404이고 컴파일·단위 테스트는 전부
통과한다** — 라우트별 고유 오류 표면(503/401 `unauthorized`/401 `session_expired`/
JSON `AUTH_FAILED`)이 곧 "배선됐는가"의 판정이다.

### 기동 순서

1. `main.ts`: env 로드 → MySQL 풀 생성 → `createServer(env, { mysql })`
2. `main.ts`: `verifyMigrations`(**여기서만** MySQL 왕복 — 아래 배포 절 참고).
   실패면 `server.close()` + exit 1.
3. `server.listen()`:
   `closeUnrecoverableGamesOnStartup`(재시작으로 이어갈 수 없는 PLAYING 방 폐쇄) →
   `OrphanedRoundStateSweeper.start()`(5분 주기) → `app.listen(SERVER_PORT)`
   - 스위퍼는 라운드 상태가 Redis에 사는 지금부터 실전에서 필요하다. 인메모리였을
     때는 재시작이 상태를 함께 지워 고아가 생기지 않았다.

### 종료 훅 (`server.close()`, SIGTERM·SIGINT)

`heartbeat.stop()` → `closeScheduler.stop()`(빈 방 폐쇄 예약) →
`sweeper.stop()` → `deadlineScheduler.stop()`(라운드·듀얼·탁구 마감 예약) →
`gateway.close()` → `app.close()` → (주입받지 않았다면) Redis·MySQL 종료.
**주입한 쪽이 닫는다**: `main.ts`가 넘긴 풀은 `main.ts`가 닫고, 통합 테스트가 넘긴
Redis는 하네스가 닫는다. 인메모리 예약을 먼저 끊는 이유는 unref된 타이머가 남으면
이미 닫힌 Redis를 두드리기 때문이다(테스트에서는 스위트 간 누수가 된다).

## 모니터링

- `GET /actuator/health` → `{"status":"UP"}`. 경로 변경은 배포 검증·모니터링과
  함께서만(Phase 5).
  - ⚠️ **지금 이 응답은 상수다**(`http/routes/health.ts:26`). Redis와 MySQL이 둘 다
    죽어도 `UP`을 낸다. 즉 이 엔드포인트는 "프로세스가 HTTP를 받는다"까지만 증명하며
    **readiness를 뜻하지 않는다.** 이미지의 `HEALTHCHECK`(`backend/Dockerfile:92`)와
    외부 uptime 체크가 같은 한계를 물려받는다.
  - Redis `PING` + MySQL `SELECT 1` + 5초 캐시로 바꾸는 것이
    [`deploy/PLAN.md`](../../../deploy/PLAN.md)의 PR 1이다. 한 번의 변경이 컨테이너
    `HEALTHCHECK` · 배포 게이트(`up -d --wait`) · 외부 체크 세 곳을 동시에
    업그레이드하므로 배포 재설계의 선행 조건이다.
- `GET /actuator/prometheus` — 노출 메트릭(이름·태그가 계약):
  - `yorr_rooms_active` (gauge): 인메모리 phase가 PLAYING인 방 수
  - `yorr_game_participants_active{game="YACHT_DICE"|...}` (gauge): PLAYING
    방에서 **라이브 소켓**을 가진 플레이어 수(오프라인 좌석 제외). 태그 값은
    대문자 게임 코드(WS 네임스페이스와 달리 소문자화하지 않는다)
- 그 외 액추에이터 엔드포인트는 노출하지 않는다(health·prometheus만) —
  `env`·`beans`·`metrics`처럼 방·세션 정보가 인증 없이 새는 표면을 늘리지 않는다.
- Java에는 메시지 레이트·지연·소켓 수 계측이 없다 — 추가는 자유지만 위 두 개는 유지.

### Node 구현 (5.3)

- 두 라우트 모두 `http/routes/health.ts`(`registerHealthRoutes(app, { metrics })`).
  게이지 수집기는 `monitoring/realtimeGameMetrics.ts`(`RealtimeGameMetrics` —
  Java `monitoring/RealtimeGameMetrics` MeterBinder 자리), 텍스트 렌더러는
  `monitoring/exposition.ts`.
- **수집 출처는 WS 레지스트리의 인메모리 상태**다(`RoomSessionRegistry.activeRoomCount()`
  ·`activeParticipantCount(code)`). Java도 같았고, **Redis 왕복은 없다** — 스크레이프
  주기마다 SCAN을 던지면 모니터링이 부하 원인이 된다. 단일 인스턴스 전제(DESIGN.md 원칙 8)
  라 phase·소켓이 인메모리에 있어 이 값이 곧 이 프로세스의 진실이다.
  - 계열(태그 조합)은 `GameModuleRegistry.supportedCodes()`(= 카탈로그) 전체이며,
    값이 0인 게임도 줄을 낸다(계열이 사라지면 대시보드가 끊긴다).
  - 스크레이프 시점에 세는 **pull 게이지**다. 증감 카운터를 따로 들지 않는 이유는
    offline 전이·소켓 교체·방 폐쇄 중 한 곳만 빠뜨려도 값이 조용히 어긋나기 때문이다.
- 노출 형식은 Prometheus 텍스트 0.0.4(`# HELP`·`# TYPE` 포함), Content-Type
  `text/plain; version=0.0.4; charset=utf-8`.
- **의존성 0**이다 — `prom-client`를 쓰지 않는다. 노출 대상이 게이지 둘뿐이고
  (histogram·summary 없음) 형식이 `name{tag="v"} value`라 렌더러가 40줄이다
  ([ADR-0003](../adr/0003-node-fastify-stack.md)의 기조). 계약은 **이름·태그**이므로
  스크레이퍼가 보는 것은 같다. 집계가 필요한 계측(지연 히스토그램 등)이 생기면 그때
  별도 티켓으로 `prom-client`를 도입하고 `exposition.ts`를 대체한다.
- `metrics` 배선이 없으면 `/actuator/prometheus`는 **404가 아니라 503**이다(auth
  라우트의 미설정 503과 같은 규약). 스크레이프가 빈 본문으로 조용히 성공하는 것이
  이 저장소의 상습 실패 모드(배선 누락)에서 최악이라서다.
- 테스트: 값·형식은 `monitoring/__tests__/metrics.test.ts`(가짜 소켓으로 PLAYING·오프라인
  전이·재접속을 만들어 숫자 변화를 고정), 경로 표면은
  `http/routes/__tests__/metrics.test.ts`(health 응답·Content-Type·다른 액추에이터 경로 404).

## 배포 파이프라인 (5.1 — GitHub Actions → GHCR → OCI ARM64 단일 호스트)

결정과 기각한 대안: [ADR-0006](../adr/0006-github-actions-ghcr-arm64-single-host.md).
파일: `.github/workflows/backend.yml` · `backend/Dockerfile` ·
`backend/.dockerignore` · `deploy/compose.yaml`.

> ⚠️ **이 절은 지금 돌아가는 것을 기술한다. 여기에 확정 결함 두 개가 있다**
> (아래 「알려진 결함」). 이것을 Release 단위 pull CD로 교체하는 계획은
> [`deploy/PLAN.md`](../../../deploy/PLAN.md)에 있고, **아직 구현하지 않았다.**
> 이 문서는 cutover가 끝난 뒤에 갱신한다 — 없는 것을 있다고 적지 않는다.

### 알려진 결함 (2026-08-22 확인)

| # | 무엇 | 어디 | 영향 |
|---|---|---|---|
| A | `config_changed`가 **구조적으로 항상 false**다. `auto-deploy.sh:27`이 `deploy/`로 `cd`한 뒤 `:106`이 `git diff … -- deploy/`를 부르므로 실제 검사 대상이 `deploy/deploy/`가 된다(git pathspec은 cwd 기준). 매치가 없으면 git은 경고 없이 exit 0이다 | `deploy/auto-deploy.sh:106` | 설정만 바뀐 배포가 감지되지 않는다. 대부분의 커밋에서는 `metadata-action`의 OCI 라벨이 image ID를 매번 바꿔 `image_changed=true`가 **우연히** 성립해 가려진다 |
| B | 배포 검증이 **실패를 잡지 못한다.** `up -d`는 컨테이너 *시작*만 확인하고 exit 0을 내며 `ps`·`logs`·`config\|grep`은 무슨 일이 있어도 exit 0이다 | `deploy/deploy.sh:73-85` | `main.ts`의 exit 1을 파이프라인이 **한 번도 보지 않는다.** 게다가 crash 루프 컨테이너는 이미 새 image ID를 가지므로 다음 회차에 `image_changed=false`가 되어 **자동 배포가 재시도조차 하지 않고 조용해진다** |

둘 다 수정은 [`deploy/PLAN.md`](../../../deploy/PLAN.md)의 PR 3에서 이뤄진다
(A는 변경 감지 자체가 사라지므로 고치지 않고 삭제되고, B는 `--wait`로 대체된다).

**`.github/workflows/deploy.yml`(버튼)은 등록 이후 실행 횟수가 0회다.** 즉 아래
「배포하는 세 경로」 중 버튼 경로는 문서상으로만 존재하며 한 번도 검증되지 않았다.
PLAN.md의 PR 4에서 제거한다.

### 대상 환경

| 항목 | 값 |
|---|---|
| 호스트 | Oracle Cloud Always Free, Ampere A1, 2 OCPU / 12GB |
| 아키텍처 | **linux/arm64 (aarch64)** — x86 이미지는 돌지 않는다 |
| 규모 | 상시 동접 50명, 방 10~20개 |
| 스택 | 같은 호스트에 backend · Redis · MySQL · Caddy(TLS) |
| 여는 포트 | **80 · 443 (TCP)뿐.** coturn을 배포하지 않으므로 UDP 릴레이 범위가 없다 |
| 음성 | STUN-only (`YORR_VOICE_TURN_SECRET` 미설정 = 코드가 자동으로 그 모드) |
| 프론트 | Vercel(`https://yorr.site`) — 그래서 **`wss://`가 필수이고 TLS가 선택이 아니다** |

### 흐름

```text
PR ─────────────► verify(check·typecheck·test·build) + compose 문법 + arm64 이미지 빌드(push 안 함)
main push ──────► verify ─► image ─► ghcr.io/jadewisemann/yorr-backend:{main, sha-<커밋>}
                                            │
호스트가 당긴다 ──────────────────────────────┘  auto-deploy.sh(5분): 바뀐 게 있고 + 게임이 0이면 → deploy.sh -y
사람이 시작 ─────────────────────────────────┘  deploy.sh (언제든, 게임 중에도)
```

`git pull`이 배포의 일부인 이유: 공개 주소 네 개의 정본이 `deploy/compose.yaml`이고
그 파일은 **호스트의 git 체크아웃에서 읽힌다**(이미지에는 없다). 빼먹으면 새
이미지가 옛 설정으로 뜬다 — 증상은 "배포했는데 그대로"다.

### 배포하는 세 경로 (같은 몸통)

| | 어디서 | 게임 중이면 | 쓰는 때 |
|---|---|---|---|
| 자동 | 호스트의 systemd timer(5분) → `auto-deploy.sh` | **미룬다** — 다음 회차에 다시 본다 | 평상시. 켜 두면 손댈 일이 없다 |
| 버튼 | GitHub Actions 탭 → `deploy` 워크플로 | **끊는다** | 앞당길 때, 롤백할 때. 로그가 GitHub에 남는다 |
| 손 | 호스트에서 `deploy/deploy.sh` | 확인을 묻고 **끊는다** | 러너·네트워크가 죽었을 때의 최후 경로 |

셋 다 실제 배포는 `deploy.sh`를 부른다 — 갈래가 갈라지면 한쪽만 낡는다.

**버튼**(`.github/workflows/deploy.yml`)은 `workflow_dispatch` 전용이고 태그
입력이 하나 있다(`main` = 최신, `sha-xxxxxxx` = 롤백). 롤백은 `.env`의
`BACKEND_IMAGE`에 **고정으로 적히므로** 5분 타이머가 되돌리지 않는다 — 대신 고정된
동안 자동 배포는 아무것도 하지 않는다(그 태그는 움직이지 않는다). 원인을 고친 뒤
같은 버튼을 `main`으로 한 번 더 눌러 고정을 푼다.

**셀프호스티드 러너를 쓰는 이유**는 ADR-0006 §3의 기각 사유를 지키기 위해서다:
러너는 **호스트에서 GitHub으로 나가는 연결**로 일감을 받으므로 22번 포트를 열지
않고 배포 키도 Secrets에 두지 않는다. 설치(호스트에서 한 번):

```bash
# Settings → Actions → Runners → New self-hosted runner 가 주는 명령을 쓰되,
# config.sh 에 라벨을 붙이고 서비스로 등록한다(로그아웃해도 살아 있게).
./config.sh --url https://github.com/jadewisemann/yorr --token <UI가 준 값> \
            --labels yorr-oci --name yorr-oci --unattended
sudo ./svc.sh install && sudo ./svc.sh start
```

⚠️ 러너를 돌리는 계정이 **docker 그룹에 있고 `~/yorr`에 쓸 수 있어야** 한다
(자동 배포 타이머와 같은 조건). 그리고 셀프호스티드 러너에서는 믿을 수 없는 코드를
돌리지 않는다 — `deploy.yml`만 이 러너를 쓰고 `pull_request`로는 돌지 않는다.
다른 워크플로는 `ubuntu-latest`에 남겨 둔다.

> **이 경로는 제거 예정이다**([`deploy/PLAN.md`](../../../deploy/PLAN.md) PR 4).
> 근거 셋: ① `deploy.yml` 실행 횟수가 **0회**라 실익이 없다 ② 이 저장소는 **public**
> 이고 러너 계정이 docker 소켓을 쥐고 있어 워크플로 실행이 사실상 호스트 root다
> ③ 같은 pull 기반 배포를 systemd 타이머가 이미 한다. 위의 「나가는 연결」 논거는
> 여전히 옳지만, 그것은 SSH 배포와 비교했을 때의 이야기이고 **러너를 아예 두지
> 않는 쪽이 더 낫다.** 최종 신뢰 방향은 GitHub → GHCR ← OCI(pull only)이며,
> 패키지가 public이라 OCI가 GitHub 자격증명을 하나도 들지 않는다.

**자동 배포의 판단 순서**(`auto-deploy.sh`, 하나라도 안 맞으면 조용히 끝난다):

1. `git pull --ff-only` — compose·설정 갱신
2. `docker compose pull backend` — GHCR의 `main` 태그
3. **바뀐 것이 있나**: 이미지 ID가 다르거나 이 pull이 `deploy/`를 건드렸나
   - ⚠️ 뒷절반(`config_changed`)이 **구조적으로 항상 false**다(위 「알려진 결함」 A).
     지금 이 판단을 실제로 결정하는 것은 이미지 ID 비교뿐이고, 그 비교가 성립하는
     이유도 `metadata-action`이 커밋마다 라벨을 바꿔 주기 때문이라는 **우연**이다.
4. **게임이 없나**: 컨테이너 안에서 `/actuator/prometheus`를 읽어
   `yorr_rooms_active`(PLAYING 방 수)가 0인가

`ADR-0006` §3이 자동 배포를 기각했던 두 근거를 둘 다 지킨다(그 절의 갱신 메모):

- **호스트가 당기고 아무도 밀지 않는다.** GitHub에 배포 키가 없고 22번 포트를
  러너에게 열지 않는다 — 여는 것은 여전히 80·443뿐이다.
- **게임을 끊지 않는다**(대신 미룬다). 게이지를 못 읽으면 `unknown`이고 **0으로
  보지 않는다** — 못 읽었을 때 끊는 쪽으로 기울지 않는다.
- 다만 바쁜 서버에서 영원히 밀리지 않도록 상한이 있다:
  `YORR_DEPLOY_MAX_DEFER`(기본 21600s = 6시간)를 넘기면 진행 중이어도 배포한다.
  `0`으로 두면 "게임이 끝날 때까지 영원히 기다린다".

설치·중단(호스트에서 한 번):

```bash
sudo cp ~/yorr/deploy/systemd/yorr-auto-deploy.* /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now yorr-auto-deploy.timer
journalctl -u yorr-auto-deploy -f                        # 무엇을 판단했는지
sudo systemctl disable --now yorr-auto-deploy.timer      # 끄면 ADR-0006 원래 상태
```

⚠️ **유닛 파일을 손으로 고치지 마라.** `deploy/systemd/yorr-auto-deploy.{service,timer}`는
**git 추적 파일**이다. 호스트에서 그것을 편집하면 `auto-deploy.sh`의 첫 단계인
`git pull --ff-only`가 영구 실패하고, 세 배포 경로가 그 한 줄을 공유하므로 **동시에
죽는다.** 증상은 "배포가 그냥 안 된다"이고 원인은 로그를 끝까지 읽어야 드러난다.

호스트별 값(`User=`·경로)을 반영하는 것은 `--install`이 한다.

```bash
~/yorr/deploy/auto-deploy.sh --install     # 유닛을 심고 타이머를 켠다
~/yorr/deploy/auto-deploy.sh --uninstall   # 되돌린다
```

기본값은 OCI Ubuntu 이미지의 `ubuntu`이고, 그 계정이 docker 그룹에 있어야 한다.
이미 유닛을 손으로 고쳐 버렸다면 `git -C ~/yorr status --porcelain=v1 -b`로 확인하고
`git checkout -- deploy/systemd/` 후 `--install`로 다시 심는다.

- **빌드는 배포 대상 서버에서 하지 않는다.** 2 OCPU를 빌드와 실서비스가 나눠 쓰면
  라운드 마감 타이머(25s+1s)가 밀린다. 호스트는 pull만 한다.
- **이미지는 x86 러너에서 에뮬레이션 없이 만든다.** Dockerfile이 `npm ci`·`tsc`를
  전부 `--platform=$BUILDPLATFORM` 스테이지에서 끝내고 arm64 스테이지에는 `RUN`이
  없다. 근거는 **런타임 의존성 트리에 네이티브 애드온·아키텍처 게이트·install
  스크립트가 하나도 없다는 것**이고, Dockerfile의 `prod-deps` 스테이지가 매 빌드마다
  `node_modules`에서 `*.node`를 찾아 그 전제를 검사한다.
  ⚠️ **런타임 스테이지에 `RUN`을 넣지 마라** — 넣는 순간 QEMU가 필요해진다.
- **워크플로가 배포하지 않는다.** 배포가 진행 중 게임을 끊기 때문이다(아래).
  자동화는 호스트 쪽에 있다 — GitHub이 미는 것이 아니라 호스트가 당기고,
  게임이 없을 때만 진행한다(아래 「배포하는 세 경로」).

### CI 검사 (`verify` 잡)

`npm ci` → `npm run check` → `npm run typecheck` → `npm test` → `npm run build`
(backend/AGENTS.md 「검증 명령」과 같은 순서).

- **`redis-server` 바이너리를 apt로 설치하고 `REDIS_TEST_REQUIRED=1`을 켠다.**
  service container가 아니라 바이너리인 이유는 ADR-0004의 기본 경로가 "테스트
  파일마다 유닉스 소켓 인스턴스 하나"이기 때문이다 — 공유 Redis 하나에 vitest의
  병렬 파일들이 `FLUSHALL`을 걸면 서로를 깬다.
- **`mysql:8.0` service container + `MYSQL_TEST_URL`·`MYSQL_TEST_REQUIRED=1`.**
  하네스가 테스트마다 `yorr_test_<random>` 스키마를 CREATE/DROP하므로 root 자격이
  필요하다. **MySQL 통합 테스트 45건이 처음으로 실제로 도는 자리다** — 지금까지
  전부 skip이었고 SQL이 실행된 적이 없다(ADR-0005).
- 두 `*_TEST_REQUIRED` 스위치가 없으면 CI가 "조용히 건너뛴 초록"으로 거짓말한다.

### 배포 단위와 롤백

- 이미지: `ghcr.io/jadewisemann/yorr-backend`. 태그 `main`이 "지금 배포 가능한
  것", `sha-<커밋>`이 롤백 대상이다.
- 롤백 = `deploy/.env`의 `BACKEND_IMAGE`를 sha 태그로 바꿔 `up -d backend`.
- 배포 검증은 여전히 **HTTP 헬스체크가 아니라** `sleep 15` + 컨테이너 Running
  확인이다. 애플리케이션은 설정 오류를 안고 뜨지 않는다(env.ts의 fail-fast 근거).
  확인됨: MySQL 없이 `node dist/main.js`는 `ECONNREFUSED` 로그와 함께 exit 1이다.
- ⚠️ **그러나 그 exit 1을 배포 스크립트가 보지 못한다**(위 「알려진 결함」 B).
  `up -d`는 컨테이너 *시작*까지만 확인하고 exit 0을 내며, 뒤따르는
  `ps`·`logs`·`config | grep`도 전부 exit 0이다. 결과적으로 **실패한 배포가
  "배포 완료"로 보고된다.** 손 배포에서 특히 위험하다 — 긴급 롤백 뒤 초록색 출력을
  보고 접속을 끊게 된다.
  - 이미지에는 이미 제대로 된 `HEALTHCHECK`가 있으므로(`backend/Dockerfile:92`,
    `SERVER_PORT`까지 존중) 고치는 방법은 `docker compose up -d --wait
    --wait-timeout 120`이다. 다만 그 게이트가 의미를 가지려면 `/actuator/health`가
    먼저 진짜여야 한다(위 「모니터링」) — 그래서
    [`deploy/PLAN.md`](../../../deploy/PLAN.md)에서 PR 1이 PR 3보다 앞선다.
- 그래서 **기동 시 마이그레이션 확인이 `main.ts`에 있다**: `verifyMigrations`가
  밀린 마이그레이션·실패 이력 행을 발견하면 로그를 남기고 exit 1로 죽는다
  (읽기 전용 — Node는 스키마를 바꾸지 않는다, [ADR-0005](../adr/0005-flyway-compatible-migration-runner.md)).
  체크섬 불일치와 "이력에는 있는데 파일이 없는 것"은 경고만 남기고 기동한다.
  - **`createServer()`·`listen()`에는 넣지 않는다.** 그 두 경로는 통합 테스트가
    실제로 부르며(`ws/__tests__/gateway.test.ts`), MySQL 없는 개발·CI 환경에서
    WS 테스트 전부가 깨진다. 풀은 `main.ts`가 만들어 `createServer(env, { mysql })`로
    주입하고, 주입한 쪽(`main.ts`)이 닫는다.
- 빈 DB 부트스트랩은 `npm run migrate`가 `runMigrations`를 호출한다. 운영 Compose는
  같은 진입점을 `docker compose run --rm migrate`로 노출하며, 기존 DB 덤프 복원이
  우선이므로 실제로 빈 DB에서 시작할 때만 사용한다.

### 배포는 진행 중 게임을 끊는다 (단일 인스턴스 제약)

DESIGN.md 원칙 8(WS 구독·라운드 마감 타이머·방 폐쇄 예약·오프라인 카운터·주간
랭킹 캐시가 프로세스 인메모리)의 직접적 결과다:

- **인스턴스를 2대로 늘릴 수 없다** — 브로드캐스트가 반쪽이 되고 마감 타이머가
  두 번 발화한다.
- 따라서 **무중단 롤링 배포가 원리적으로 불가능하다**(두 인스턴스 공존을 요구한다).
- 재시작하면 방 상태는 Redis에 남지만 소켓이 전부 끊기고 인메모리 마감 타이머가
  유실된다. 부팅 시 `closeUnrecoverableGamesOnStartup`이 이어갈 수 없는 PLAYING
  방을 **폐쇄한다** — 게임 중단은 버그가 아니라 설계된 동작이다.
- 남는 완화책은 **시각 선택**뿐이다. 그래서 워크플로는 이미지까지만 만들고,
  배포는 호스트에서 일어난다 — 그 "시각 선택"을 사람의 눈대중이 아니라
  `yorr_rooms_active == 0`이라는 측정으로 하는 것이 `auto-deploy.sh`다
  (위 「배포하는 세 경로」). **끊긴다는 사실이 사라진 것은 아니다**: 미루는 상한
  (`YORR_DEPLOY_MAX_DEFER`)에 걸린 배포와 손 배포는 여전히 끊는다.

### compose 계약 (`deploy/compose.yaml`)

유지: 서비스 이름 **`backend`**(rename 금지) · 설정은 **`env_file` 주입** ·
**backend는 포트를 공개하지 않는다**(바깥 길은 Caddy뿐) · 앱은 항상
`/api/v1`·`/ws/v1/game`·`/actuator/*`만 서빙한다(접두사를 벗기는 프록시 규칙 없음
— 구 dev 호스트의 `/dev-api`·`/dev-ws`는 사라졌다).

바뀐 것:

- 외부 `app-network`/`app-{main,dev}-network` 전제 → 이 파일이 만드는
  `edge`(caddy↔backend)·`internal`(backend↔redis·mysql) 두 네트워크.
  caddy는 `internal`에 붙지 않으므로 DB에 닿을 수 없다.
- main/dev 두 슬롯 → **단일 환경**. dev가 필요하면 별도 인스턴스다.
- 서비스: `backend` · `caddy` · `redis` · `mysql` · `mysql-backup` ·
  `migrate`(프로필 `bootstrap` — 평상시 뜨지 않는다).
- **`REDIS_HOST`·`DB_HOST`·`DB_PORT`·`DB_URL`은 compose가 `env_file`을 덮어쓴다.**
  "설정은 전부 env_file"에서 벗어나는 유일한 지점이고 의도한 것이다 — 옆 서비스의
  좌표는 토폴로지의 성질이다. 덕분에 구 호스트의 `.env`(그 파일의 `DB_URL`은
  `localhost`를 가리킨다)를 그대로 가져와도 동작한다. `DB_URL`을 비우는 것이
  특히 중요하다: 값이 있으면 `env.ts`가 `DB_HOST`를 덮는다(위 「환경변수」 표).
- **공개 주소 네 개는 compose가 기본값을 준다**(`${VAR:-...}`):
  `CORS_ALLOWED_ORIGINS` · `AUTH_FRONTEND_REDIRECT_URI` · `KAKAO_REDIRECT_URI` ·
  `GOOGLE_REDIRECT_URI`. 비밀이 아니고 "우리가 어느 주소로 서비스하는가"라는
  저장소의 사실이므로 정본을 여기 둔다 — **호스트 `.env`에 옮겨 적지 않는다.**
  도메인이 바뀌면 `compose.yaml`을 고쳐 커밋하고, 호스트에서는 `git pull` +
  `up -d backend`뿐이다.
  - 낡았을 때의 증상이 전부 "로그인이 안 된다"인데 원인은 서로 다르다는 것이
    이유다(CORS 403 · 로그인 후 옛 주소로 튕김 · 카카오 KOE006). 손으로 쓴
    `.env`가 그것을 조용히 만드는 자리였다 — `DB_URL`을 비우는 것과 같은 판단이다.
  - **`.env`에 값이 있으면 그 값이 이긴다**(한 호스트만 다르게 띄우는 탈출구).
    `KEY=`처럼 **빈 값은 이기지 않는다** — `:-`가 빈 값도 미설정으로 보므로
    옛 `.env`를 그대로 가져와도 운영 값으로 뜬다.
- 설정 파일은 **`deploy/.env` 하나**다. compose가 보간(`${...}`)용으로 자동으로
  읽고, `BACKEND_ENV_FILE`의 기본값이 같은 파일이다. 필수 키:
  `PUBLIC_HOST`(스킴 없는 도메인) · `MYSQL_ROOT_PASSWORD` · `DB_PASSWORD`.
  소셜 로그인을 켤 때 더하는 것은 **자격 네 개뿐이다**(`KAKAO_CLIENT_ID` ·
  `KAKAO_CLIENT_SECRET`(선택) · `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET`).
- Redis는 **AOF 영속화를 켠다**. 방은 TTL로 사라지지만 세션은 그렇지 않다
  (게스트 24h·회원 30d) — 끄면 Redis 재시작이 전원 로그아웃이다.
  `maxmemory-policy`는 `noeviction`을 유지한다(LRU로 바꾸면 세션·점수판이 조용히 사라진다).
- MySQL은 `--default-time-zone=+00:00`. 앱의 `timezone: 'Z'`와 어긋나면 주간 랭킹
  집계가 9시간 밀린 값을 쌓는다(복구 불가 — persistence.md의 `finished_at` 계약).

아직 없는 것 두 개(둘 다 [`deploy/PLAN.md`](../../../deploy/PLAN.md) PR 5):

- **리소스 제한이 한 줄도 없다** — `mem_limit`·`cpus`·`cpu_shares`·`cpuset` 0건.
  RAM은 12GB 중 10GB 이상 비어 있으므로 문제는 용량이 아니라, **잘못된 backend
  하나가 MySQL·SSH·systemd까지 굶길 수 있다는 것**이다. 2 OCPU에서 CPU 경합이
  실제 제약이다. 숫자는 실측 후에 정한다.
- **인프라 이미지 태그가 고정돼 있지 않다** — `redis:7.4-alpine`·`mysql:8.0`은
  움직이는 태그다(caddy만 `2.11.4-alpine`로 패치까지 적었다). 지금은 `deploy.sh`가
  `up -d backend`로 backend만 건드려 우연히 가려져 있지만, 스택 전체를 수렴시키는
  순간 **무인 타이머가 DB 엔진을 패치 업그레이드한다.** digest 고정이 선행 조건이다.

### 빈 MySQL에서는 backend가 뜨지 못한다 (부트스트랩)

`verifyMigrations`가 읽기 전용이라 빈 DB에서는 V1·V2가 pending → exit 1 →
재시작 루프다. `runMigrations`는 있지만 **진입점이 없다**(npm 스크립트도 CLI도 없다).
그래서 compose에 `migrate` 서비스를 두었다:

```bash
docker compose run --rm migrate     # profiles: ["bootstrap"] — 평상시 뜨지 않는다
```

**단, 순서가 있다.** 실사용자 계정·전적·주간 랭킹이 구 호스트의 MySQL에 있다.
빈 DB로 시작하는 것은 데이터 유실이다:

1. 구 호스트에서 `mysqldump --single-transaction --databases yorr` → 새 호스트로 복사
2. 새 MySQL에 복원 — `flyway_schema_history`가 함께 온다(V1·V2는 backend-java
   원본을 바이트 단위로 복사한 파일이라 체크섬이 맞는다, ADR-0005)
3. 그러면 `migrate`가 필요 없다. `migrate`는 **진짜로 빈 DB**에서만 쓴다.

### 이미지 계약 (`backend/Dockerfile`)

- 베이스 `node:22-bookworm-slim`(glibc). 런타임 스테이지는 devDependencies 없이
  `USER node`(non-root).
- **`CMD ["node", "dist/main.js"]` — `npm start`로 감싸지 않는다.** npm은 SIGTERM을
  받고 죽지만 자식 node에 전달하지 않아 종료 훅(하트비트·마감 스케줄러·소켓 정리)이
  돌지 않는다(실측 확인). node가 PID 1이어도 `process.on('SIGTERM')` 핸들러는
  정상 발화한다(PID 네임스페이스로 확인).
  - 남은 틈: `main.ts`는 `createServer`·`verifyMigrations`를 await한 **뒤에**
    핸들러를 등록한다. 그 사이(기동 수 초)의 SIGTERM은 무시되고 `docker stop`이
    10초 뒤 SIGKILL한다. 기동 중에만 해당한다.
- **`db/migration/`은 필수 산출물이다.** `tsc`는 SQL을 복사하지 않고
  `discover.ts`가 `dist/infra/migrations/`에서 `../../../db/migration/`을 읽는다.
  빠지면 ENOENT → exit 1이다.
- 이미지 자체에 `HEALTHCHECK`(`/actuator/health`의 `status`가 `UP`인지)가 있다.
  curl·wget 없이 node 내장 `fetch`만 쓴다.

### 운영자가 손으로 하는 일 (호스트 준비 체크리스트)

1. **OCI Security List / NSG**에 ingress TCP 80·443 허용. Docker가 publish한
   포트는 호스트 iptables의 INPUT을 우회하지만(FORWARD 경로) **클라우드 쪽
   방화벽은 우회하지 않는다.**
2. `PUBLIC_HOST` 결정. **OCI 공인 IP 리터럴**을 그대로 쓸 수도 있고(현재 구성 —
   Caddy가 IP 인증서를 받고 `default_sni`로 그것을 기본 인증서로 고른다),
   DNS 이름(예 `api.yorr.site`)을 쓸 수도 있다. DNS 이름을 쓰면 **A/AAAA 레코드를
   먼저** 이 인스턴스로 붙여야 한다 — Caddy의 HTTP-01 검증이 거기에 걸려 있다.
   카카오·구글 콘솔은 IP를 Redirect URI로 받아 주지 않지만 **그것이 IP 구성을
   막지는 않는다**: 콜백을 프론트 도메인으로 받고 `frontend/vercel.json`의
   rewrite가 백엔드로 넘긴다(#40). 즉 소셜 로그인 때문에 DNS 이름이 필요하지는
   않다 — 대신 `PUBLIC_HOST`를 바꿀 때 그 rewrite의 대상 주소를 함께 고친다.
3. `deploy/.env` 배치(권한 600) — `deploy/.env.example`을 복사해 채운다.
   루트 `.gitignore`가 `.env`를 이미 무시한다. **채우는 것은 비밀뿐이다**:
   `PUBLIC_HOST` · DB·Redis 비밀번호 · 소셜 자격 네 개. 주소 네 개는
   compose 기본값이다(위 「compose 계약」).
4. **GHCR 인증**: **현재 패키지는 public이므로 할 일이 없다** — 익명으로 pull된다
   (2026-08-22 확인). 비공개로 되돌리면 `read:packages` PAT로
   `docker login ghcr.io`가 필요하고, 그 순간 호스트가 GitHub 자격증명을 쥐게 된다.
5. **구 MySQL 데이터 이관**(위 부트스트랩 절) — 새 호스트 첫 기동 전에.
6. `${BACKUP_DIR}`(기본 `deploy/backup`)을 **호스트 밖으로 주기적으로 복사.**
   같은 호스트의 덤프는 백업이 아니다 — 호스트를 잃으면 함께 잃는다.
7. 프론트(Vercel)의 `VITE_API_BASE_URL`·`VITE_WS_URL`을 새 도메인으로. 그리고
   `CORS_ALLOWED_ORIGINS`에 프론트 출처가 들어 있는지 확인 — 정본은
   `compose.yaml`이다. `docker compose config | grep CORS_`로 실제로 주입되는
   값을 본다(호스트 `.env`에 옛 줄이 남아 이기고 있는지까지 그것으로 드러난다).
8. 첫 기동: `docker compose up -d --wait --wait-timeout 120` →
   `docker compose ps` → `docker compose logs --tail 100 backend`.
   `--wait` 없이 `sleep`으로 대신하면 crash 루프가 성공으로 보인다(위 「알려진 결함」 B).
9. (선택) **자동 배포 타이머 설치** — `~/yorr/deploy/auto-deploy.sh --install`.
   유닛을 손으로 복사하거나 편집하지 않는다(위 「배포하는 세 경로」의 경고 —
   유닛은 git 추적 파일이라 편집하면 `git pull --ff-only`가 영구 실패한다).
   켜지 않으면 배포는 계속 손으로 한다.

### 프론트 도메인 전환 (`*.vercel.app` → `https://yorr.site`)

프론트를 Vercel 기본 주소에서 자체 도메인으로 옮기는 것은 **출처(origin)가 바뀌는
일**이다. 쿠키를 쓰지 않으므로(아래 「출처가 바뀔 때 무엇이 깨지는가」) 손댈 곳은
목록 하나와 리다이렉트 주소 하나뿐인데, 둘 다 틀렸을 때 증상이 "CORS 403" 또는
"로그인하면 옛 주소로 튕김" 하나라서 순서대로 확인하는 편이 빠르다.

1. **Vercel**에서 도메인 추가. `yorr.site`와 `www.yorr.site` 둘 다 등록하고 한쪽을
   primary로 두면 나머지는 301이 걸린다 — 브라우저가 실어 보내는 Origin이 하나로
   모이므로 CORS 목록도 하나로 끝난다.
2. **백엔드 `CORS_ALLOWED_ORIGINS`에 `https://yorr.site`.** `compose.yaml`의
   기본값이 이미 그것 + `https://yorr-eight.vercel.app`(전환 기간의 옛 주소)이므로
   호스트에서 할 일은 없다 — 정리할 때 그 기본값에서 뺀다. **정확 일치**이고
   패턴이 아니다(`ws/gateway.ts`의 `originAllowed`) — 끝의 `/`만
   `allowedOrigins()`가 떼 준다. www를 리다이렉트하지 않고 그대로 서비스하면
   `https://www.yorr.site`도 목록에 넣어야 한다.
3. **`AUTH_FRONTEND_REDIRECT_URI`는 `https://yorr.site/auth/callback`** —
   이것도 `compose.yaml` 기본값이다. 제공자 콘솔에 등록하는 값이 아니라 우리
   서버가 로그인 끝에 보내는 프론트 주소다.
4. **프론트 `VITE_API_BASE_URL`·`VITE_WS_URL`**(Vercel 프로젝트 환경변수)을 새
   백엔드 주소로. `vercel.json`에 `/api` 프록시가 없으므로 절대 URL이어야 하고,
   HTTPS 페이지에서 `ws://`는 브라우저가 차단한다. 이 두 값의 스킴은
   `vite.config.ts`가 **빌드에서** 검사한다(`assertSecureEndpoint`) — Vercel이
   실행하는 빌드가 그것이므로, 평문 주소를 넣으면 배포가 실패하고 산출물이 나오지
   않는다. localhost 대상 평문은 로컬 프로덕션 빌드용으로 허용한다.
5. **카카오 콘솔**: 「플랫폼 > Web > 사이트 도메인」에 `https://yorr.site` 추가.
   구글은 서버 사이드 교환이라 승인된 리디렉션 URI만 보고, JavaScript 원본은
   쓰지 않는다.
6. **두 콘솔의 Redirect URI는 프론트 도메인이다** —
   `https://yorr.site/api/v1/auth/{kakao,google}/callback`. 콘솔이 IP를 받지
   않으므로 프론트로 받고 `frontend/vercel.json`의 rewrite가 그 두 경로만 백엔드로
   넘긴다(#40). 그래서 **백엔드 주소를 바꿔도 콘솔은 그대로**이고 고칠 곳은
   `vercel.json` 하나다. 백엔드가 받는 값(`KAKAO_REDIRECT_URI`·
   `GOOGLE_REDIRECT_URI`)은 콘솔 등록값과 문자 하나까지 같아야 하며, 그 정본은
   `compose.yaml`이다(다르면 카카오는 KOE006).

#### 출처가 바뀔 때 무엇이 깨지는가

| 항목 | 영향 | 이유 |
|---|---|---|
| 세션 | **전 사용자 로그아웃처럼 보인다** | 세션 토큰이 `localStorage`(origin별)에 있다. 옛 출처의 값은 옮길 방법이 없다 |
| 쿠키 | 없음 | REST는 `credentials` 미사용, 인증은 `Authorization: Bearer`. SameSite·서드파티 쿠키 문제가 생기지 않는다 |
| 초대 링크·QR | 없음 | `window.location.origin`으로 만든다 — 새 도메인에서 자동으로 새 주소가 된다 |
| Vercel Preview 배포 | 운영 백엔드를 부르면 403 | preview는 배포마다 다른 출처(`yorr-<해시>.vercel.app`)라 정확 일치 목록으로 열 수 없다. 로컬 `dev:real`은 Vite 프록시가 Origin 헤더를 떼서 우회하지만 preview에는 그 우회가 없다 |

### 구 파이프라인은 없다

루트 `Jenkinsfile`을 **삭제했다**(ADR-0006 §6의 유보를 뒤집었다 — 그 절의 갱신 메모
참고). 남아 있는 배포 경로는 둘뿐이다:

| 대상 | 경로 | 값이 오는 곳 |
|---|---|---|
| 백엔드 | GitHub Actions → GHCR → 호스트에서 `docker compose pull` | `deploy/.env` |
| 프론트 | Vercel이 직접 빌드(`npm run build`)·배포 | Vercel 프로젝트 환경변수 |

`Jenkinsfile`이 들고 있던 것 중 사라진 것은 **backend-java 재배포 스테이지**다
(`DEPLOY_LEGACY_BACKEND`로 잠겨 있어 이미 돌지 않았다). 이미 떠 있는 Java 컨테이너는
그대로 돌고, 진짜 롤백은 재배포가 아니라 "프론트·DNS를 새 호스트로 옮기지 않는
것"이다. 그래도 그 스테이지가 필요하면 git 이력에서 꺼낸다:

```bash
git show "$(git log --diff-filter=D --format=%H -1 -- Jenkinsfile)^:Jenkinsfile"
```

검사 잡은 워크플로 둘로 나뉘어 있다 — `.github/workflows/backend.yml`(`backend/**`·
`deploy/**`)과 `.github/workflows/frontend.yml`(`frontend/**`). 후자는 파이프라인
삭제로 비어 버린 프론트 검사 자리를 대신한다: `check`·`typecheck`·`test`·`build`·
`check:cycles`를 AGENTS.md와 같은 순서로 돌린다. Vercel 빌드는 `tsc -b`까지만
보므로 그것만으로는 lint·테스트가 검증되지 않는다.

⚠️ **Playwright는 어느 잡에서도 돌지 않는다.** mock E2E는 브라우저 두 개를
내려받아야 하고, 비주얼 대조는 baseline을 저장소에 두지 않는 도구다
(`frontend/playwright.visual.config.ts`).

## 프론트 개발 모드와의 접점

- `frontend npm run dev:real` / `test:e2e:real`: Vite 프록시가 `/api`·`/ws`를
  백엔드 origin으로 넘긴다(로컬은 `http://localhost:8080`). 프록시가 origin
  헤더를 제거하므로 CORS 기본값으로도 로컬 개발이 된다.
- e2e:real이 계약 검증의 최종 수단이다(ADR-0002). 백엔드 기동 감지는
  `POST /rooms`가 **아무 HTTP 응답**이나 주면 성공으로 본다.
