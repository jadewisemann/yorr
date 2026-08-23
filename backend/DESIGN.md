# YORR Backend — 시스템 설계 (source of truth)

> 이 문서는 백엔드가 **어떻게 동작하는가**의 정본이다. 코드는 How, 이 문서는
> What / Why / Invariant를 말한다. 구현과 이 문서가 어긋나면 [AGENTS.md](AGENTS.md)의
> 판정 절차를 따른다. 결정의 배경("왜 이렇게 안 했는가")은 `docs/adr/`에 있다.
>
> 이 문서와 `docs/design/*.md`는 backend-java의 **코드와 테스트 전체**,
> 그리고 프론트 와이어 계약(`frontend/src/realtime/wsEvents.ts` ·
> `frontend/src/room/api/roomApi.ts`)을 대조해 작성했다(2026-08-14, 기준 커밋 a3a2c29).
> ⚠️ `backend-java/GAME_SESSION_INTEGRATION.md`는 실제 계약보다 낡았다
> (`room.subscribe`/`room.snapshot`, `POST /users/guests` 등은 존재하지 않는 프로토콜).
> 그 문서를 명세로 쓰지 않는다 — 정본은 코드·테스트와 프론트 계약이다.

## 핵심 원칙

1. **서버 권위(server authoritative).** 방·게임 상태의 최종 권위는 항상 서버에
   있다. 클라이언트가 보내는 것은 "결과"가 아니라 "의도"다 — 주사위 값, 판정,
   점수는 서버가 생성·검증·확정한다. 야추의 주사위는 서버 RNG가 만들고,
   `round.submit`의 dice는 서버가 만든 값과 일치해야만 받아들인다.
2. **물리는 연출이다.** 클라이언트의 주사위 물리 시뮬레이션(three.js·rapier)은
   게임 결과를 결정하지 않는다. `physics result != game result`. 클라이언트
   물리 결과를 서버 상태에 반영하는 구현은 설계 위반이다.
3. **REST가 방 상태의 변경 경로, WebSocket은 구독·전파·게임 진행.**
   방 생성·참가·나가기·게임 시작·로비 복귀·봇 관리는 REST로만 Redis 상태를
   바꾼다. WS `room.join`은 **인메모리 구독**(소켓↔방 연결)과 인증만 하며 Redis
   멤버십을 바꾸지 않는다. WS로 흐르는 것은 브로드캐스트와 게임 진행 메시지다.
4. **재접속은 스냅샷 동기화.** 재접속 클라이언트는 증분 이벤트로 상태를
   재구성하지 않는다. `room.join` 재전송 → `sys.reconnected{snapshot}`이 새로운
   동기화 기준점이다. 별도의 `sys.reconnect` 메시지는 **없다**(타입 선언만 존재).
5. **와이어 계약의 정본은 프론트엔드.** `frontend/src/realtime/wsEvents.ts`
   (프로토콜 버전 1)와 `frontend/src/room/api/*.ts`가 계약의 SSOT다. 서버는 이
   계약을 구현하는 쪽이며, 계약 변경은 프론트와 함께 결정한다. 알려진 결함
   (야추 타입 결합 등)도 그대로 구현한다([ADR-0002](docs/adr/0002-strangler-wire-contract.md)).
6. **Redis는 실시간, MySQL은 영속.** 방·세션·진행 중 게임 상태·점수판은 Redis,
   계정·전적·주간 랭킹은 MySQL. 게임이 진행되는 동안 MySQL을 만지지 않는다 —
   MySQL 기록은 게임 종료(전적 보관) 시점에만 일어난다.
7. **동시성 있는 상태 전이는 Redis Lua로 원자적으로.** 정원·중복 참가·점수
   확정·게임 종료 판정은 전부 Lua 스크립트 한 번으로 검증+갱신한다. 반환 코드가
   곧 계약이다. 스크립트가 키 이름을 내부에서 조립하므로 **단일 Redis 노드
   전제**다(클러스터 전환 시 별도 ADR).
8. **단일 인스턴스 전제.** WS 구독, 라운드 마감 **타이머 발화**, 방 폐쇄 예약,
   오프라인 카운터, 주간 랭킹 캐시는 프로세스 인메모리다. 수평 확장은 이
   마이그레이션의 범위 밖이다(backend-java와 동일한 제약).
   - 이 원칙에서 **"무중단 롤링 배포가 불가능하다"까지는 필연**이다(두 인스턴스
     공존을 요구하므로). 그러나 **"배포가 진행 중 게임을 끊는다"는 필연이 아니었다.**
     마감 **시각**은 이제 Redis에 있고 부팅 때 그 값으로 재무장한다
     (`game/startupResume.ts` · `game/round/deadlineStore.ts`).
   - **그래도 원칙 8은 바뀌지 않았다.** 프로세스 밖으로 나간 것은 "마감 시각"이라는
     *데이터*이고, "누가 타이머를 발화하는가"라는 *책임*은 그대로 이 프로세스에 있다.
     그래서 분산 락도 pub/sub도 도입하지 않았다. 두 인스턴스를 띄우면 같은 마감이
     두 번 발화하므로, 이 변경이 수평 확장을 허락하는 것은 아니다.

## 아키텍처

```text
Mobile / Desktop Browser
        │
        ├── REST /api/v1/**   ── 방·계정·조회·퀵매치·랭킹 (상태 변경 경로)
        ├── WS   /ws/v1/game  ── 인증·구독·브로드캐스트·게임 진행·음성 시그널링
        └── WebRTC voice      ── P2P 풀 메시 (시그널 릴레이만 WS, TURN 자격은 REST)
                  │
                  ▼
          Node.js Backend (이 저장소)   ←  GET /actuator/health · /actuator/prometheus
             │           │
             ▼           ▼
           Redis       MySQL
   방·세션·게임 상태·점수판   계정·소셜 연동·전적·주간 랭킹
```

- WebSocket 연결(소켓↔방 구독)은 프로세스 인메모리로만 관리한다. 멤버십·점수·
  phase 등 진짜 상태는 Redis가 가진다. 서버 재시작 시 소켓은 끊기지만 방 상태는
  살아 있고, 클라이언트는 재접속 절차로 복귀한다.
- **라운드 마감 시각도 Redis에 있다.** 부팅 시 진행 중이던 방을 그 마감으로 되살리고
  (`game/startupResume.ts`), 되살릴 수 없는 방만 닫는다. 예전에는 마감이 프로세스
  인메모리 Map에만 있어 `PLAYING` 방을 **전부** 닫는 것이 유일한 방어였고
  (`StaleRoomCleaner`), 같은 이유로 재시작 후 진행 중이던 야추 방에 재접속하면
  스냅샷 생성이 `DEADLINE_NOT_FOUND`로 반드시 실패했다. 마감 시각이 처음부터 절대
  벽시계 epoch ms였으므로 영속화에 의미 변화가 없었다
  ([PLAN.md](../deploy/PLAN.md) PR 6).
  - 좌석 레지스트리는 여전히 프로세스 인메모리다. 그래서 재시작 뒤의 첫 `room.join`은
    **방 명단(Redis)** 을 근거로 자기 자리를 되찾는다 — 레지스트리만 보면 자기 방인데도
    새 참가로 보여 `GAME_ALREADY_STARTED`로 거절된다.
- 게스트도 회원도 같은 모양의 Redis 세션(`user:{id}` 해시)을 쓴다. 방·게임
  코드는 사용자 종류를 구분할 필요가 없다([rooms-and-sessions.md](docs/design/rooms-and-sessions.md)).

## 하위 시스템

| 하위 시스템 | 문서 | 요약 |
|---|---|---|
| 실시간 통신 | [docs/design/realtime.md](docs/design/realtime.md) | envelope, 연결 수명, 하트비트, room.join, 메시지 카탈로그, 오류 계약 |
| 방·세션 | [docs/design/rooms-and-sessions.md](docs/design/rooms-and-sessions.md) | REST 계약, Redis 키·Lua 스크립트, phase 상태기계, 파티 모드, 봇, 퀵매치, 방 수명 |
| 게임 프레임워크 | [docs/design/game-modules.md](docs/design/game-modules.md) | GameModule, 라운드·타이머, 점수 확정 파이프라인, 게임 종료, 조회 REST |
| 야추 | [docs/design/games/yacht.md](docs/design/games/yacht.md) | 주사위 릴레이·상태기계, 점수 도메인, 봇 |
| 석양이 진다 | [docs/design/games/duel.md](docs/design/games/duel.md) | 신호·판정 규칙, 반응 시간 검증 |
| 탁구 | [docs/design/games/pingpong.md](docs/design/games/pingpong.md) | 랠리 시뮬레이션, 지연 보상, AI 결과 |
| 재접속 | [docs/design/reconnect.md](docs/design/reconnect.md) | 스냅샷 동기화 불변식, 소켓 교체, 오프라인 처리 |
| 인증·계정 | [docs/design/auth.md](docs/design/auth.md) | 세션 모델, 소셜 로그인(OAuth), 프로필 |
| 음성 채팅 | [docs/design/voice.md](docs/design/voice.md) | 시그널 릴레이, voice.peers, ICE/TURN |
| 영속성 | [docs/design/persistence.md](docs/design/persistence.md) | Redis/MySQL 분리, 스키마, 전적 보관, 주간 랭킹 |
| 운영 | [docs/design/operations.md](docs/design/operations.md) | 환경변수, 모니터링, 배포 파이프라인 계약 |

## 코드 구조

`src/` 바로 아래는 역할이다. 게임별 구현은 `game/` 아래에 게임 단위로 둔다
(프론트의 도메인 우선 원칙과 동일 취지 — 게임 하나를 이해하려고 레이어 여섯 개를
뒤지지 않게 한다).

| 폴더 | 책임 | backend-java 대응 |
|---|---|---|
| `config/` | 환경변수 로딩·검증 (`env.ts`) | `application.yaml`, `@ConfigurationProperties` |
| `http/` | REST 라우트. Fastify 핸들러는 얇게, 로직은 도메인 서비스로 | `*Controller` |
| `ws/` | WebSocket 게이트웨이 — envelope, 하트비트, 구독 레지스트리, 브로드캐스터, 음성 릴레이 | `handler/`, `ws/` |
| `room/` | 방 도메인 — Redis 키·Lua, 방 서비스, 퀵매치, 봇, 방 폐쇄 스케줄러 | `room/` |
| `user/` | 세션·게스트·프로필 | `user/` |
| `auth/` | 소셜 로그인(OAuth), 로그인 코드·state 스토어 | `auth/` |
| `game/` | GameModule 인터페이스·레지스트리, 라운드 프레임워크, 점수 파이프라인, `game/yacht/` 등 게임별 모듈 | `game/` |
| `infra/` | Redis·MySQL 클라이언트 팩토리, Lua 스크립트 등록·호출 체계. 도메인 로직 금지 | Spring Data 설정, `DefaultRedisScript` |
| `errors.ts` | 도메인 오류의 공통 뿌리 `DomainError` — 메시지 자리에 **문자열 오류 코드**가 들어간다 | `IllegalArgumentException("room_full")` 관용 |
| `main.ts` / `server.ts` | 부팅·조립. 조립 순서 외의 로직 금지 | `YorrApplication` |

- 테스트는 소스와 같은 폴더의 `__tests__/`에 둔다. 여러 스위트가 함께 쓰는
  테스트 하네스(Redis 통합 테스트용 서버 등)만 `src/` 밖 `test/`에 둔다 —
  빌드 산출물에 들어가지 않게 하기 위해서다([ADR-0004](docs/adr/0004-redis-integration-test-harness.md)).
- 도메인 규칙(점수 계산·판정)은 전송 계층(HTTP·WS)을 몰라야 한다 —
  backend-java의 `ScoreConfirmationService` / `DuelRules` / `PingPongRules` 분리와
  같은 원칙.

## 오류 계약 (전 계층 공통 원칙)

backend-java의 오류 표면은 세 가지 형식이 섞여 있고, **이 모양 그대로가 계약이다**:

1. **REST 대부분**: 상태 코드 + **plain-text 문자열 코드** 본문(`room_full`,
   `invalid_nickname`, `session_expired` …). JSON 봉투가 아니다. 프론트
   `client.ts`가 이 문자열을 대문자 코드로 매핑한다.
2. **게임 조회 REST**(`/rooms/{id}/scores`·`/results`): JSON
   `{"code","message"}` (`GameQueryErrorResponse`).
3. **WebSocket**: `error` 타입 envelope + `{code(SCREAMING_SNAKE), message, refMsgId?}`.

상세 표는 각 하위 시스템 문서에 있다. 새 오류를 추가하거나 형식을 통일하는 일은
마이그레이션 범위 밖이다(계약 동결).

구현: 도메인은 `errors.ts`의 `DomainError`(Java `IllegalArgumentException` 자리,
400/404) · `ConflictError`(`IllegalStateException` 자리, 409)로 코드 문자열을
던지고, `http/errorResponse.ts`가 상태 코드와 plain-text 본문으로 옮긴다.

## 운영 계약 (변경 시 배포 파이프라인과 함께)

- 헬스체크: `GET /actuator/health` → `{"status":"UP"}` (Spring Actuator 경로 유지).
  ⚠️ **지금 이 응답은 상수다**(`http/routes/health.ts:26`) — Redis와 MySQL이 죽어도
  `UP`이다. 즉 liveness에 가깝고 readiness가 아니며, 이미지의 `HEALTHCHECK`와 외부
  uptime 체크가 같은 한계를 물려받는다. Redis `PING` + MySQL `SELECT 1` + 5초 캐시로
  바꾸는 것이 [`deploy/PLAN.md`](../deploy/PLAN.md) PR 1이고, 경로와 응답 모양은
  그대로 유지한다(실패 시 503).
- 메트릭: `GET /actuator/prometheus` — `yorr_rooms_active`,
  `yorr_game_participants_active{game=...}` ([operations.md](docs/design/operations.md))
- REST base: `/api/v1`, WebSocket: `/ws/v1/game`, 기본 포트 8080
- CORS: REST(`/api/**`)와 WS 핸드셰이크, 그리고 **소셜 로그인의 복귀 출처**가
  같은 `CORS_ALLOWED_ORIGINS` 목록을 쓴다(복귀 출처는
  [auth.md](docs/design/auth.md) 「복귀 출처」 — 목록이 둘이면 한쪽만 갱신될 때
  "CORS는 되는데 로그인만 안 된다"가 된다). 기본값은 운영 도메인(`https://yorr.site`)만 — dev 출처가 운영에 새지
  않도록 fail-safe. credentials 미사용(인증은 `Authorization: Bearer`이므로 프론트
  도메인이 바뀌어도 쿠키 계약이 없다). 대조는 **정확 일치**이고 패턴이 아니다 —
  `allowedOrigins()`가 공백과 끝의 `/`만 정규화한다(도메인 전환 절차:
  [operations.md](docs/design/operations.md)).
- 환경변수 이름은 backend-java와 동일하게 유지한다([operations.md](docs/design/operations.md)의 전체 표).
