# YORR Backend — 시스템 설계 (source of truth)

> 이 문서는 백엔드가 **어떻게 동작하는가**의 정본이다. 코드는 How, 이 문서는
> What / Why / Invariant를 말한다. 구현과 이 문서가 어긋나면 [AGENTS.md](AGENTS.md)의
> 판정 절차를 따른다. 결정의 배경("왜 이렇게 안 했는가")은 `docs/adr/`에 있다.
>
> ⚠️ 현재 이 문서는 backend-java의 동작을 기준으로 작성된 **초기 모델**이다.
> 마이그레이션이 진행되며 각 절은 실제 이식된 구현과 대조·갱신된다(단계별 상태는
> [PLANS.md](PLANS.md)).

## 핵심 원칙

1. **서버 권위(server authoritative).** 방·게임 상태의 최종 권위는 항상 서버에
   있다. 클라이언트가 보내는 것은 "결과"가 아니라 "의도"다 — 주사위 결과, 판정,
   점수는 서버가 생성·검증·확정한다.
2. **물리는 연출이다.** 클라이언트의 주사위 물리 시뮬레이션(three.js·rapier)은
   게임 결과를 결정하지 않는다. `physics result != game result`. 클라이언트
   물리 결과를 서버 상태에 반영하는 구현은 설계 위반이다.
3. **REST가 방 상태의 변경 경로, WebSocket은 구독·전파.** 방 생성·참가·나가기·
   게임 시작은 REST로만 일어난다. WebSocket은 인증된 구독과 브로드캐스트,
   그리고 게임 진행 메시지(`round.submit` 등)를 나른다.
4. **재접속은 스냅샷 동기화.** 재접속한 클라이언트는 증분 이벤트로 상태를
   재구성하지 않는다. 서버가 내려주는 스냅샷이 새로운 동기화 기준점이 된다.
5. **와이어 계약의 정본은 프론트엔드.** `frontend/src/realtime/wsEvents.ts`가
   WebSocket 계약의 SSOT다(프로토콜 버전 1). 서버는 이 계약을 구현하는 쪽이며,
   계약 변경은 프론트와 함께 결정한다.
6. **Redis는 실시간, MySQL은 영속.** 방·세션·진행 중 게임 상태는 Redis에,
   계정·전적·주간 랭킹은 MySQL에 둔다. 동시성 있는 상태 전이는 Redis Lua
   스크립트로 원자적으로 처리한다.

## 아키텍처

```text
Mobile / Desktop Browser
        │
        ├── REST /api/v1/**  ── 방·계정·조회 (상태 변경 경로)
        ├── WS   /ws/v1/game ── 구독·브로드캐스트·게임 진행
        └── WebRTC voice     ── P2P (시그널링만 WS 경유)
                  │
                  ▼
          Node.js Backend (이 저장소)
             │           │
             ▼           ▼
           Redis       MySQL
      방·세션·게임 상태  계정·전적·랭킹
```

WebSocket 연결(소켓 ↔ 방 구독)은 프로세스 인메모리로만 관리한다. 멤버십·점수·
phase 등 진짜 상태는 Redis가 가진다. 따라서 서버 재시작 시 소켓은 끊기지만
방 상태는 살아 있고, 클라이언트는 재접속 절차로 복귀한다.

## 하위 시스템

| 하위 시스템 | 문서 | 요약 |
|---|---|---|
| 실시간 통신 | [docs/design/realtime.md](docs/design/realtime.md) | envelope, 하트비트, 구독, 브로드캐스트 |
| 방·세션 | [docs/design/rooms-and-sessions.md](docs/design/rooms-and-sessions.md) | Redis 키 스킴, phase 상태기계, 게스트 세션 |
| 게임 모듈 | [docs/design/game-modules.md](docs/design/game-modules.md) | GameModule 인터페이스, 라운드·타이머, 점수 확정 |
| 재접속 | [docs/design/reconnect.md](docs/design/reconnect.md) | 스냅샷 동기화 불변식 |
| 영속성 | [docs/design/persistence.md](docs/design/persistence.md) | Redis/MySQL 분리, 스키마 마이그레이션 |

## 코드 구조

`src/` 바로 아래는 역할이다. 게임별 구현은 `game/` 아래에 게임 단위로 둔다
(프론트의 도메인 우선 원칙과 동일 취지 — 게임 하나를 이해하려고 레이어 여섯 개를
뒤지지 않게 한다).

| 폴더 | 책임 |
|---|---|
| `config/` | 환경변수 로딩·검증 (`env.ts`) |
| `http/` | REST 라우트. Fastify 핸들러는 얇게, 로직은 도메인 서비스로 |
| `ws/` | WebSocket 게이트웨이 — envelope 파싱, 하트비트, 방 구독 레지스트리 |
| `game/` | GameModule 인터페이스·레지스트리, 이후 `game/yacht/` 등 게임별 모듈 |
| `infra/` | Redis·MySQL 클라이언트 팩토리. 도메인 로직 금지 |
| `main.ts` / `server.ts` | 부팅·조립. 조립 순서 외의 로직 금지 |

- 테스트는 소스와 같은 폴더의 `__tests__/`에 둔다.
- 도메인 규칙(점수 계산 등)은 전송 계층(HTTP·WS)을 몰라야 한다 —
  backend-java의 `ScoreConfirmationService` 분리와 같은 원칙.

## 운영 계약 (변경 시 배포 파이프라인과 함께)

- 헬스체크: `GET /actuator/health` → `{"status":"UP"}` (Spring Actuator 경로 유지)
- REST base: `/api/v1`, WebSocket: `/ws/v1/game`, 기본 포트 8080
- CORS 허용 출처: `CORS_ALLOWED_ORIGINS` (기본값은 운영 도메인만)
