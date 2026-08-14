# 운영 (환경변수 · 모니터링 · 배포 계약)

> 상위 원칙은 [DESIGN.md](../../DESIGN.md). Java 원본: `application.yaml`,
> `config/`, `monitoring/`. 배포 파이프라인: 루트 `Jenkinsfile`,
> `deploy/compose.yaml`.

## 환경변수 (backend-java와 이름 동일 유지)

| 변수 | 기본값 | 용도 |
|---|---|---|
| `DB_URL` / `DB_USERNAME` / `DB_PASSWORD` | 없음(필수) | MySQL |
| `REDIS_HOST` / `REDIS_PORT` | 없음(필수) | Redis |
| `REDIS_PASSWORD` | `""` | Redis |
| `SERVER_PORT` | `8080` | 리슨 포트 |
| `CORS_ALLOWED_ORIGINS` | `https://yorr.site` | REST·WS 공용 허용 출처(콤마 목록). 기본값이 운영 전용인 것이 fail-safe 설계다 |
| `AUTH_FRONTEND_REDIRECT_URI` | `http://localhost:5173/auth/callback` | 로그인 콜백 후 프론트 복귀 |
| `KAKAO_CLIENT_ID` / `KAKAO_CLIENT_SECRET`(선택) / `KAKAO_REDIRECT_URI` | `""` / `""` / localhost 콜백 | 카카오 OAuth |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | `""` / `""` / localhost 콜백 | 구글 OAuth |

Java에서 `@Value`로만 존재해 yaml에 없는 것(환경으로만 주입) — Node에서는
env.ts에 정식 편입한다:

| 변수(제안: Java 프로퍼티 대응) | 기본값 | 용도 |
|---|---|---|
| `VOICE_TURN_SECRET` (`yorr.voice.turn.secret`) | `""` = TURN 미제공 | coturn 공유 시크릿 |
| `VOICE_TURN_HOST` (`yorr.voice.turn.host`) | `""` = TURN 미제공 | TURN 호스트 |
| `VOICE_STUN_URL` (`yorr.voice.stun-url`) | `stun:stun.l.google.com:19302` | STUN |
| `VOICE_TURN_TTL_SECONDS` (`yorr.voice.turn.ttl-seconds`) | `600` | 자격 TTL |

테스트 전용 변수(런타임은 읽지 않는다 — [ADR-0004](../adr/0004-redis-integration-test-harness.md)):

| 변수 | 기본값 | 용도 |
|---|---|---|
| `REDIS_TEST_URL` | 없음 = 테스트가 `redis-server`를 직접 띄운다 | 이미 떠 있는 Redis로 통합 테스트를 돌린다 |
| `REDIS_TEST_REQUIRED` | 없음 | `1`이면 Redis가 없을 때 건너뛰지 않고 실패한다. **파이프라인에 `npm test`를 넣을 때 켠다**(Phase 5) |

프로퍼티처럼 동작하는 하드코딩 상수(설정 아님 — 바꾸면 계약 변경):
프로토콜 버전 1, 하트비트 30s/타임아웃 90s, 방 TTL 40분, 빈 방 유예 30s/게임 중
10분, 턴 25s+유예 1s, 오프라인 허용 2턴, 게스트 24h/회원 30d, 스위퍼 5분.

## 모니터링

- `GET /actuator/health` → `{"status":"UP"}`. 경로 변경은 배포 검증·모니터링과
  함께서만(Phase 5).
- `GET /actuator/prometheus` — 노출 메트릭(이름·태그가 계약):
  - `yorr_rooms_active` (gauge): 인메모리 phase가 PLAYING인 방 수
  - `yorr_game_participants_active{game="YACHT_DICE"|...}` (gauge): PLAYING
    방에서 **라이브 소켓**을 가진 플레이어 수(오프라인 좌석 제외). 태그 값은
    대문자 게임 코드(WS 네임스페이스와 달리 소문자화하지 않는다)
- 그 외 액추에이터 엔드포인트는 노출하지 않는다(health·prometheus만).
- Node 구현은 prom-client 등으로 같은 이름·태그를 재현한다. Java에는 메시지
  레이트·지연·소켓 수 계측이 없다 — 추가는 자유지만 위 두 개는 유지.

## 배포 파이프라인 계약 (현재 = backend-java 기준, Phase 5에서 전환)

Jenkins(`pollSCM`, main·develop 분기만):

- 변경 감지가 **`backend-java/**`·`deploy/**`·`Jenkinsfile`에 하드코딩**되어
  있다 — `backend/**`(Node)는 현재 CI/CD에 연결되어 있지 않다. 전환 시 수정
  지점: changeset 패턴(5곳), 빌드 스테이지(gradle bootJar → npm build),
  `docker build` 대상 디렉터리.
- 이미지 태그 `backend:prod`(main) / `backend:dev`(develop),
  컨테이너 `yorr-backend-{main|dev}`, env 파일 `/infra/app/.env.{main|dev}`.
- compose(`deploy/compose.yaml`): 서비스 이름 `backend`(폴더 경로 아님 — rename
  금지), **포트 미공개** — 외부 `app-network`의 리버스 프록시가 별칭
  (`backend-main`/`backend-dev`)으로 접근한다. 설정은 전부 `env_file`로 주입.
  dev 호스트의 `/dev-api`·`/dev-ws` 접두사는 프록시가 벗긴다 — 앱은 항상
  `/api/v1`·`/ws/v1/game`만 서빙한다.
- 배포 검증이 **HTTP 헬스체크가 아니라** `sleep 15` + 컨테이너 Running 확인
  뿐이다. Node 프로세스는 기동 실패 시 즉시 종료(exit≠0)해야 이 검증에
  걸린다 — 설정 오류를 안고 뜨는 것 금지(env.ts의 fail-fast 근거).

Node 백엔드가 슬롯에 들어가기 위한 조건 요약: env 파일만으로 완전 설정,
`SERVER_PORT`(프록시가 기대하는 포트) 리슨, 기동 15초 내 안정, `/api/v1/*` +
`/ws/v1/game` + `/actuator/*` 서빙, Dockerfile 제공.

## 프론트 개발 모드와의 접점

- `frontend npm run dev:real` / `test:e2e:real`: Vite 프록시가 `/api`·`/ws`를
  백엔드 origin으로 넘긴다(로컬은 `http://localhost:8080`). 프록시가 origin
  헤더를 제거하므로 CORS 기본값으로도 로컬 개발이 된다.
- e2e:real이 계약 검증의 최종 수단이다(ADR-0002). 백엔드 기동 감지는
  `POST /rooms`가 **아무 HTTP 응답**이나 주면 성공으로 본다.
