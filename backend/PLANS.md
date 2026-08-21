# PLANS — Java → JS 백엔드 마이그레이션 구현 계획

> 진행 중 변경의 계획서. "시스템이 어떻게 동작하는가"는 [DESIGN.md](DESIGN.md),
> "왜 이 마이그레이션인가"는 [ADR-0001](docs/adr/0001-backend-js-migration.md),
> "왜 이 방식인가"는 [ADR-0002](docs/adr/0002-strangler-wire-contract.md) 참고.
> 각 티켓이 끝날 때마다 체크리스트와 상태 표를 갱신한다.

## 목표

`backend-java/`(Spring Boot)의 모든 기능을 `backend/`(Node.js + TypeScript)로
이식하고 운영 트래픽을 전환한 뒤 backend-java를 제거한다.

## 원칙

- **프론트엔드 무변경.** REST·WebSocket 와이어 계약을 동결한다. 계약의 정본은
  `frontend/src/realtime/wsEvents.ts` + `frontend/src/room/api/*.ts` +
  backend-java 코드·테스트다. ⚠️ `backend-java/GAME_SESSION_INTEGRATION.md`는
  낡았다 — 명세로 쓰지 않는다.
- **backend-java 동결.** 참조 구현으로만 읽는다. 운영 hotfix는 별도 브랜치.
- **수직 슬라이스.** 기능 단위로 REST + WS + 상태 + 테스트를 끝까지 옮기고
  실제 프론트로 검증한다.
- **테스트가 명세다.** backend-java의 테스트 케이스를 vitest로 함께 이식한다.
  통과하는 테스트 없이 "이식 완료"라고 하지 않는다. 각 설계 문서 끝의 "이식할
  대표 테스트" 목록이 최소선이다.
- **동작 차이는 기록 후 결정.** Java 쪽 버그·quirk도 조용히 고치지 않는다 —
  설계 문서의 "알려진 틈"과 IMPLEMENTATION_NOTES.md에 기록하고 재현/수정
  여부를 명시적으로 정한다. 지금까지 결정된 것: `type` 누락 envelope의 NPE는
  재현하지 않음(INVALID_MESSAGE로 처리), 나머지 quirk는 기본 재현.

## 단계

의존 순서: P1 → P2 → P3. P4는 P1 이후 언제든 병행 가능(MySQL·auth는 게임과
독립). P1 내부의 1.6(음성)·1.7(퀵매치 골격 제외)도 병행 가능.

### Phase 0 — 백본 ✅

- [x] `backend` → `backend-java` 이동, 파이프라인·문서 경로 갱신
- [x] Node 22 + TS + Fastify + ws + Biome + Vitest 백본
- [x] envelope 파싱, `sys.connected`/`sys.ping`/`sys.pong`, 구독 레지스트리 골격
- [x] `GET /actuator/health`, CORS, 환경변수 스킴
- [x] GameModule 인터페이스·레지스트리 스켈레톤
- [x] 문서 체계 도입 및 **backend-java 전수 분석으로 설계 문서 상세화**(이 PR)

### Phase 1 — 플랫폼 코어

프론트가 로비까지 실제로 동작하는 최소 서버. 근거 문서:
[rooms-and-sessions.md](docs/design/rooms-and-sessions.md) ·
[realtime.md](docs/design/realtime.md) · [voice.md](docs/design/voice.md).

| # | 티켓 | Java 참조 | 이식할 테스트 |
|---|---|---|---|
| 1.1 ✅ | Redis 배선: ioredis 연결, `defineCommand` Lua 등록 체계(`infra/lua.ts`), 통합 테스트 하네스([ADR-0004](docs/adr/0004-redis-integration-test-harness.md) — 로컬 `redis-server` spawn) | `RedisConfig` 상당 | — |
| 1.2 ✅ | 세션·사용자: `user:{id}` 해시, 토큰 해시·역인덱스, 게스트/회원 TTL 슬라이딩, authenticate 2경로, closeSession, assignRoom/clearRoom, 닉네임 정규화 | `user/service/UserService` | `UserServiceSessionIntegrationTest`(로그아웃 양경로 차단, 재로그인 무효화, TTL 차등), `UserServiceTest` |
| 1.3 ✅ | 방 도메인: 키 스킴 + Lua 9종(CREATE/JOIN/LEAVE/CLOSE/TOUCH/START/ROLLBACK/CANCEL/RETURN_TO_LOBBY) + 방 코드 생성 + 스냅샷 조회(REST 모양) + 게임 메타데이터 스텁 레지스트리(YACHT_DICE 1..6·bots / DUEL·PING_PONG 2..2·no bots — 정원·minPlayers·supportsBots만) | `room/service/RoomCreateService`·`RoomValidationService`, `RoomRedisKeys` | `RoomValidationServiceTest`, `RoomCloseIntegrationTest`, `PartyRoomIntegrationTest`(host 승계·파티 생존·봇 승계 제외) |
| 1.4 ✅ | 방 REST: `POST /rooms`(생성·참가·게스트·파티, snake_case 응답), leave, start, lobby 복귀, `GET /games/{id}` + **plain-text 오류 계약**(401 문자열 3종 포함) | `room/controller/RoomController`·`RoomValidationController`·`GameController` | `RoomValidationControllerTest` |
| 1.5 ✅ | WS 코어: room.join(인증·재접속 분기·순서 계약)/joined/player_joined/leave/ready/reaction, 레지스트리·브로드캐스터(1회 직렬화), 하트비트 모니터(90s·CAS), presence, phase별 끊김 처리, 방 폐쇄 스케줄러(30s/10m 유예), StaleRoomCleaner, 실시간 병합 스냅샷 + 핸드셰이크 origin 검사·메시지 64KB 상한·소켓별 직렬 처리 | `handler/GameWebSocketHandler`, `ws/*`, `room/infrastructure/InMemoryRoomCloseScheduler`, `room/initializer/StaleRoomCleaner` | `GameWebSocketHandlerTest`(유예·재접속·세션만료 구분·유령 방 거부 등), `HeartbeatMonitorTest`(90s 경계·멱등), `RoomSessionRegistryTest`, `RealtimeRoomSnapshotServiceTest` |
| 1.6 ✅ | 봇 REST: ADD/REMOVE Lua + `state.sync` 브로드캐스트 + supportsBots 게이트 | `room/service/BotParticipantService`, `RoomBotController` | `BotParticipantServiceTest`, `RoomBotControllerTest`, `PartyRoomIntegrationTest`의 봇 승계 케이스 |
| 1.7 ✅ | 음성: voice.join/leave/signal 릴레이, 명단 관리(끊김 시 정리 순서), `GET /voice/ice`(coturn HMAC) | `GameWebSocketHandler` voice 절, `ws/voice/*` | `RoomSessionRegistryVoiceTest`, `GameWebSocketHandlerTest` voice 케이스(from 스푸핑 차단, 부재 상대 무음 드롭) |

- **완료 기준**: 프론트 `dev:real`로 방 생성 → 초대 참가 → 로비 표시·리액션·
  음성 명단까지 동작. `e2e:real`의 로비 스위트(방 생성+스냅샷, 게스트 join
  브로드캐스트, 미존재 코드 ROOM_NOT_FOUND, 6석 ROOM_FULL) 통과.
  - 1.5에서 그중 로비 스위트를 **인프로세스로 좁혀** 옮겼다
    (`ws/__tests__/gateway.test.ts` — 진짜 소켓 + REST). 프론트 실물 검증은
    1.6·1.7까지 끝난 뒤 한 번에 한다(리액션·봇·음성 명단이 같은 화면이다).
  - **1.7까지 끝났으므로 이 실물 검증이 지금 밀린 항목이다.** 인프로세스
    테스트(266건)는 전부 통과하지만 프론트 `dev:real`·`e2e:real`은 아직 돌리지
    않았다 — Phase 2 진행과 병행해 Phase 1 슬라이스를 닫는다.
- 주의: WS 프로토콜은 room.subscribe가 아니라 **room.join**이다. Phase 0
  스켈레톤의 registry/게이트웨이를 이 계약에 맞춰 손봤다(1.5 완료).

### Phase 2 — 게임 프레임워크

게임과 무관한 진행 공통 기반. 근거 문서: [game-modules.md](docs/design/game-modules.md) ·
[reconnect.md](docs/design/reconnect.md).

| # | 티켓 | Java 참조 | 이식할 테스트 |
|---|---|---|---|
| 2.1 ✅ | GameModule 인터페이스를 Java 시그니처에 정렬(start(roomCode, game)·reconnect→스냅샷 등), 레지스트리 dispatch(접두사 검증·스트립), GameLifecycleService(start→롤백, returnToLobby) | `game/module/*` | `GameModuleRegistryTest`(정규화·교차 네임스페이스 거부), `GameLifecycleServiceTest`(실패 시 롤백) |
| 2.2 ✅ | RoundState 도메인 + RoundSubmission(+Result·Completion) — 불변 전이 전부 | `game/round/domain/*` | `RoundStateTest`(라운드 캡, 종료 후 전면 거부, withoutParticipant 규칙), `RoundSubmissionTest` |
| 2.3 ✅ | 마감 스케줄러: 세대 카운터, **슬롯 선등록**(레이스 회귀 — 인라인 executor 테스트 필수), cancel/cancelRoom | `round/infrastructure/InMemoryRoundDeadlineScheduler` | `InMemoryRoundDeadlineSchedulerTest` 3종 전부 |
| 2.4 ✅ | RoundStateStore 포트 + 인메모리 구현(테스트 시드, beforeStateChange 시맨틱) | `round/application/port/*`, `round/infrastructure/InMemoryRoundStateStore` | (2.5~2.7 테스트가 사용) |
| 2.5 ✅ | RoundTimerService: 25s+1s 유예, touch 연동, advanceTurn 합류점, 오프라인 스킵·2턴 퇴장, removePlayer 경로 / RoundTimeoutResolver: autoRoll→카테고리 자동 기록→무득점 강등 / RoundSynchronizationService(서버 RNG 시드 시임) | `round/application/*` | `RoundTimerServiceTest`(브로드캐스트 순서, 캡 도달 시 비재무장), `RoundTimeoutResolverTest` 5종, `RoundSynchronizationServiceTest` |
| 2.6 ✅ | 점수 파이프라인: ScoreCategory/YachtScoreCalculator/ScoreBoard 도메인, ScoreConfirmationService(서버 재계산·시그니처), **CONFIRM_SCORE Lua**(반환 코드 10종), ScoreRoundSubmissionService(원자 결합) | `game/domain/*`, `game/service/Score*`, `game/repository/RedisScoreBoardStore·Mapper` | `YachtScoreCalculatorTest`, `ScoreCategoryTest`, `ScoreBoardTest`(null vs 0), `ScoreConfirmationServiceTest`, `ScoreRoundSubmissionServiceTest`, `RedisScoreBoardStoreIntegrationTest`(멱등 재시도·동시 16건·보너스 63·스테일 매핑 차단) |
| 2.7 | 게임 종료: FINISH_IF_COMPLETE Lua(`_` 규약·force), GameCompletionService(CAS 실패 시 무부수효과, game.over→state.sync 순서, 랭킹 1,2,2,4), 전적 보관은 no-op 스텁 | `game/repository/*CompletionStore*`, `round/application/GameCompletionService`, `game/domain/GameResultCalculator` | `RedisGameCompletionStoreIntegrationTest`(동시 8건 1승·메타 필드 비산입·로비 복귀 후 재게임), `GameCompletionServiceTest`, `GameResultCalculatorTest` |
| 2.8 | 재접속 스냅샷(GameReconnectSnapshotService — rollCount·dice·held 동봉) + OrphanedRoundStateSweeper(5분, cancel→remove 순서) | `round/application/GameReconnectSnapshotService`·`OrphanedRoundStateSweeper` | `GameReconnectSnapshotServiceTest`, `OrphanedRoundStateSweeperTest` |
| 2.9 | 조회 REST: `/rooms/{id}/scores`·`/results`(JSON 오류 계약, 읽기 재시도 스토어), `/games/{id}/score-candidates`(무인증 계산기) | `game/controller/*`, `game/service/GameScoreQueryService`·`ScoreCandidateService`, `game/repository/RedisGameScoreQueryStore` | `GameScoreQueryControllerTest`(12키 null 직렬화), `ScoreCandidateControllerTest`, `RedisGameScoreQueryStoreTest`(재시도) |

- **완료 기준**: 프레임워크 단위 테스트 전부 + 야추 모듈 없이 인메모리
  스토어로 라운드 사이클(시작→제출→타임아웃→종료)이 통합 테스트로 검증됨.
- `GameAbortService`는 데드 코드 — 이식하지 않는다(결정 기록:
  game-modules.md).

### Phase 3 — 게임 모듈

기준 게임(야추)부터. 게임 하나 끝날 때마다 프론트 E2E로 검증. 근거 문서:
[games/yacht.md](docs/design/games/yacht.md) · [games/duel.md](docs/design/games/duel.md) ·
[games/pingpong.md](docs/design/games/pingpong.md).

| # | 티켓 | Java 참조 | 이식할 테스트 |
|---|---|---|---|
| 3.1 ✅ | `game/yacht/`: 모듈(5메시지 라우팅·오류 매핑·roomId 검증), RedisYachtDiceStateStore(락·SETNX·TTL 복사·스냅샷 직렬화), YachtTurnActionService, dice 릴레이(shake 무음/throw 오류 비대칭), msgId 에코 규약 | `game/yacht/*` (봇 제외) | `YachtTurnActionServiceTest`, `RedisYachtDiceStateStoreIntegrationTest`(동시 1건), `GameWebSocketHandlerTest`의 dice·submit 케이스 |
| 3.2 ✅ | 야추 봇: 오케스트레이터(세대 가드·지연 4종), 코디네이터(TurnVersion·킵 재사용), Expectimax(정확 확률·메모·1초 예산), Local 폴백 | `game/yacht/Bot*`·`*Policy`·`*Strategy`, `ScorecardValueEvaluator` | `BotTurnOrchestratorTest`, `YachtBotTurnCoordinatorTest` 8종, `ExpectimaxYachtBotPolicyTest`(1초 예산 포함), `LocalYachtBotStrategyTest`, `ScorecardValueEvaluatorTest`, `YachtBotGameCompletionTest`(2봇 완주) |
| 3.3 ✅ | `game/duel/`: DuelRules(판정·파울·캡), 상태 스토어(version 비증가 무시), 스케줄링(version 키), forfeit, 점수=잔탄 | `game/duel/*` | `DuelRulesTest` 12종 전부 |
| 3.4 ✅ | `game/pingpong/`: PingPongRules(궤적·판정 창·judgedAt 120ms), 준비 게이트, 서브 로테이션, PREPARING 이탈 취소 시퀀스 | `game/pingpong/*` (AI REST 제외) | `PingPongRulesTest` 7종, `PingPongGameServiceTest`(취소 순서) |
| 3.5 ✅ | 퀵매치: 큐·락·매칭(최장 대기 host·롤백), **전원 소켓 라이브 조건 자동 시작**, 상태 폴링 자기 치유 | `room/service/QuickMatchService`, `QuickMatchController` | `QuickMatchServiceIntegrationTest` 8종(소켓 조건·티켓 소비·FINISHED 자기 치유 포함) |

- **완료 기준**: 게임별로 frontend `npm run test:e2e:real` 통과. 야추는 봇
  포함 완주, duel·pingpong은 2인 실플레이 + 재접속 시나리오.

### Phase 4 — 계정·기록 (P1 이후 병행 가능)

근거 문서: [auth.md](docs/design/auth.md) · [persistence.md](docs/design/persistence.md).

| # | 티켓 | Java 참조 | 이식할 테스트 |
|---|---|---|---|
| 4.1 ✅ | MySQL 배선 + 마이그레이션 도구 ADR(기준: Flyway 이력 테이블 호환, V1·V2를 적용됨으로 인식). 전환기 스키마 동결 | `application.yaml` flyway 절, `db/migration/*` | — |
| 4.2 ✅ | 소셜 로그인: authorize/callback/session/me/logout, state·로그인 코드 스토어(1회용 시맨틱), kakao·google 클라이언트(타임아웃·인코딩·오류 일반화), 가입 경합 처리(트랜잭션 분리) | `auth/*` | `SocialLoginServiceTest`(경합 승자 재조회 포함), `KakaoOAuthClientTest`, `GoogleOAuthClientTest` |
| 4.3 ✅ | 프로필: GET/PATCH `/users/me`(member_only, DB+세션 dual-write) | `user/application/UserProfileService`, `UserProfileController` | `UserProfileServiceIntegrationTest` 4종 |
| 4.4 ✅ | 전적 보관: MatchArchiveService(UTC 시계·멱등·닉네임 우선순위·users로 회원 판정) + 2.7의 스텁 교체 | `game/match/*` | `MatchArchiveServiceIntegrationTest` 4종 |
| 4.5 ✅ | 주간 랭킹: KST 월요일 경계→UTC 변환, 회원 최고점 집계, 내 순위, 캐시(키 규약·전체 evict), REST(무인증 목록/204/member_only) | `game/ranking/*`, `CacheConfig` | `WeeklyRankingServiceTest`(경계 초 단위), `WeeklyRankingQueryIntegrationTest`(게스트 제외·캐시 3종·동율), `RankingControllerTest` |
| 4.6 ✅ | 탁구 AI 결과 REST(점수 재검증·UUID·게스트/회원 분기) | `game/pingpong/PingPongAiResult*` | `PingPongAiResultServiceTest`, `PingPongAiResultControllerTest` |

- **완료 기준**: 소셜 로그인 → 게임 → 전적·랭킹 조회가 실 DB로 동작.

### Phase 5 — 운영 전환

근거 문서: [operations.md](docs/design/operations.md) ·
[ADR-0006](docs/adr/0006-github-actions-ghcr-arm64-single-host.md).

호스트가 SSAFY EC2 → **Oracle Cloud Always Free(Ampere A1, 2 OCPU/12GB, ARM64)** 로
바뀌었다. coturn/TURN은 배포하지 않기로 정했다(음성은 STUN만 — `YORR_VOICE_TURN_SECRET`이
비면 코드가 자동으로 STUN-only다). 그래서 열 포트는 80·443뿐이다.

- [x] **5.1 배포 전환**: `backend/Dockerfile`(4스테이지 크로스 빌드, linux/arm64,
      non-root, `CMD ["node","dist/main.js"]`) · `.dockerignore` ·
      `deploy/compose.yaml`(backend·caddy·redis·mysql·mysql-backup·migrate,
      MySQL 볼륨 + 일일 덤프). 기동 실패 시 exit≠0 · PID 1 SIGTERM 발화 ·
      크로스 빌드 전제(런타임 의존성에 네이티브 게이트 0) 실측 확인.
      ⚠️ **이미지를 실제로 빌드하지 못했다**(작업 환경에 Docker 데몬 없음) —
      첫 `docker buildx build`는 GHA의 `image` 잡이다. Caddy TLS·WS Upgrade·
      arm64 실기동도 미검증.
- [x] **5.2 CI: Jenkins → GitHub Actions**(`.github/workflows/backend.yml`).
      `redis-server` + `REDIS_TEST_REQUIRED=1`([ADR-0004](docs/adr/0004-redis-integration-test-harness.md)),
      mysql:8.0 service + `MYSQL_TEST_REQUIRED=1`([ADR-0005](docs/adr/0005-flyway-compatible-migration-runner.md)).
      `Jenkinsfile`은 프론트 Vercel 배포가 아직 거기 있어 존치하고 백엔드 스테이지
      5개를 `DEPLOY_LEGACY_BACKEND`(기본 false)로 잠갔다 — compose 재작성이 Java
      배포 경로를 깼기 때문이다. **진짜 롤백 수단은 프론트·DNS를 옮기지 않는 것**이다.
- [x] **5.3 모니터링**: `/actuator/health` 유지, `/actuator/prometheus`에
      `yorr_rooms_active`·`yorr_game_participants_active{game}` 동일 노출
      (`monitoring/` + `http/routes/health.ts`, **의존성 0**의 자체 렌더러).
      배선 누락 시 404가 아니라 503이다.
- [ ] **머지 전 선행 차단 항목** — 배포하려면 먼저:
      - [x] `package.json`의 `migrate` 스크립트 + 마이그레이션 CLI.
            `docker compose run --rm migrate`가 같은 진입점을 사용한다.
      - [ ] **구 호스트 MySQL 덤프 → 새 호스트 복원.** 실사용자 계정·전적·랭킹이
            구 호스트에 있다. 덤프를 복원하면 `flyway_schema_history`가 함께 와서
            `verifyMigrations`가 통과한다(V1·V2 바이트 동일).
            **빈 DB로 시작 = 데이터 유실**
      - [ ] OCI 호스트 준비: Security List/NSG에 80·443 ingress ·
            `PUBLIC_HOST` A/AAAA 레코드 · `deploy/.env`(600) 배치 · GHCR 인증 ·
            `${BACKUP_DIR}`를 호스트 밖으로 주기 복사
- [x] **MySQL 통합 테스트 첫 실행 결과 확인.** GitHub Actions의 mysql:8.0에서
      `MYSQL_TEST_REQUIRED=1`로 전체 테스트가 통과했다(2026-08-14, run 31787188195).
- [ ] **프론트 `e2e:real` 통과.** Phase 3의 완료 기준이며 배선이 방금 들어갔으므로
      3.1·3.3·3.4·3.5는 아직 닫히지 않았다.
- [ ] 부하·재접속 시나리오 검증(하트비트 타임아웃, 유예 close, 소켓 교체,
      StaleRoomCleaner 부팅 동작). 상시 50명 규모에서 봇 Expectimax의 이벤트 루프
      점유를 함께 본다(3.2 실측 기준 decide 1회 14~16ms — 재검토 조건은
      [games/yacht.md](docs/design/games/yacht.md)).
- [ ] 트래픽 전환. **무중단 롤링은 원리적으로 불가능하다**(DESIGN 원칙 8 — WS 구독·
      타이머가 인메모리라 2대로 늘릴 수 없고, 재시작이 진행 중 게임을 끊는다).
      남는 완화책은 시각 선택뿐이라 배포를 자동으로 걸지 않았다.
- [ ] backend-java 제거 + 프론트 Vercel 배포 이전 + `Jenkinsfile` 삭제
      + GAME_SESSION_INTEGRATION.md 등 낡은 문서 정리 (별도 PR)
- **완료 기준**: 운영 도메인이 Node 백엔드를 서빙하고 한 주간 무회귀.

## 연습 방 시계 제거 — 계약 변경 1건 (2026-08-21, 완료)

> 이 저장소에서 **와이어 계약을 의도적으로 넓힌 첫 변경**이다. 원칙(「프론트엔드
> 무변경」)의 예외이므로 여기 남긴다. 프론트 쪽 계획·표기는
> [frontend/PLANS.md](../frontend/PLANS.md) 「요트 라이트 모드 · 연습 방 시계」 절.

- **무엇**: 봇을 뺀 사람이 하나 이하인 방(연습 방)에는 턴 제한 시간을 두지 않는다.
  `round.start.deadline`과 재접속 스냅샷의 `game.roundDeadline`이 `number | null`이
  됐고, null이면 프론트가 타이머를 그리지 않는다.
- **왜 계약을 넓혔나**: 제한 시간의 목적은 멈춘 한 사람 때문에 나머지가 기다리는 것을
  막는 것이다. 혼자 하는 방에는 그 목적이 없다. "아주 먼 마감"으로 우회하면 화면에
  59:59가 떠 있게 되므로(로컬 튜토리얼이 실제로 그랬다) 값 자체를 없앴다.
- **호환**: 넓히기만 했다. 숫자 마감을 보내는 서버(backend-java 롤백 포함)에서도
  프론트는 그대로 동작한다 — 기능이 없을 뿐이다. backend-java는 동결이라 이식하지 않는다.
- **구현**: `RoundTimerService.UNTIMED_HUMAN_LIMIT`. 판정은 방 스냅샷의 `kind`로 하고,
  스냅샷을 못 읽으면 기존 동작(시계 있음)으로 떨어진다. 연습 방의 **봇 턴에는 예약만**
  남긴다(방송은 null) — 봇 스텝 예외의 유일한 폴백이라서다. 설계는
  [game-modules.md](docs/design/game-modules.md) 「RoundTimerService」.

## 상태 표

| 하위 시스템 | Java 위치 | 설계 문서 | 상태 |
|---|---|---|---|
| WS 게이트웨이·envelope·하트비트 | `handler/`, `ws/` | realtime.md | ✅ 코어(1.5) + 음성(1.7) + 게임 dispatch(2.1) 이식 완료 |
| 세션·게스트·회원 | `user/` | rooms-and-sessions.md | ✅ 세션·인증(1.2) + 프로필 REST(4.3) 이식 완료. 프로필의 MySQL 통합 6건은 `MYSQL_TEST_URL` 부재로 **미실행** |
| 방·Lua·파티·폐쇄 수명 | `room/` | rooms-and-sessions.md | ✅ 키·Lua 9종·스냅샷·REST·폐쇄 스케줄러·StaleRoomCleaner 이식 완료(1.3·1.4·1.5) |
| 봇 참가자 | `room/service/BotParticipantService` | rooms-and-sessions.md | ✅ ADD/REMOVE Lua·REST·supportsBots 게이트·`state.sync` 이식 완료(1.6) |
| 퀵매치 | `room/service/QuickMatchService` | rooms-and-sessions.md | ✅ 큐·락(토큰 CAS 해제 Lua)·최장 대기 host·롤백, **WS 소켓 생존 조건 자동 시작**, 티켓 소비·FINISHED 자기 치유, REST 3종 이식·배선 완료(3.5) |
| 게임 모듈 프레임워크 | `game/module/` | game-modules.md | ✅ 시그니처 Java 정렬·레지스트리 dispatch(접두사 검증·스트립·교차 네임스페이스 거부)·GameLifecycleService(start 실패 시 롤백) 이식 완료(2.1). 정원·minPlayers·supportsBots는 카탈로그가 유일한 출처 |
| 라운드·타이머·타임아웃 | `game/round/` | game-modules.md | ✅ 도메인·마감 스케줄러·스토어 포트(2.2~2.4) + 타이머·타임아웃 해소·동기화 서비스(2.5) 이식 완료. 바깥 계층은 좁은 포트로 역전 — 점수·게임 종료는 2.6·2.7이 구현. **Java와 한 곳 갈린다**: 연습 방 시계 제거(위 절) |
| 점수 확정·조회 | `game/service/`, `game/repository/` | game-modules.md | ✅ 점수 도메인·CONFIRM_SCORE Lua(반환 코드 10종)·확정 서비스·라운드 원자 결합(2.6) + 게임 종료·랭킹(2.7) + 조회 REST(2.9) 이식·배선 완료 |
| 재접속 스냅샷·스위퍼 | `game/round/application/` | reconnect.md | ✅ 재접속 스냅샷(rollCount·dice·held 동봉, scores는 Map→객체 정규화 — Java 그대로면 버그였다) + OrphanedRoundStateSweeper(5분, cancel→remove, `listen()`에서 기동) 이식·배선 완료(2.8) |
| 야추 (+봇) | `game/yacht/` | games/yacht.md | 🚧 모듈·`RedisYachtDiceStateStore`(운영 라운드 저장소)·`YachtTurnActionService`·dice 릴레이 비대칭·`markPhase('playing')`(3.1) + 봇 스택(3.2 — 지연 4종·세대 가드·TurnVersion·Expectimax **예산 강제**·Local 폴백·2봇 완주) 이식·배선 완료, 총 120건. **프론트 e2e:real 미검증** |
| 석양이 진다 | `game/duel/` | games/duel.md | 🚧 DuelRules(판정·파울·캡)·상태 스토어(version 비증가 무시)·version 키 스케줄링·forfeit·점수=잔탄 이식·배선 완료(3.3, `DuelRulesTest` 12종 전부). **프론트 e2e:real 미검증** |
| 탁구 (+AI 결과) | `game/pingpong/` | games/pingpong.md | 🚧 규칙(궤적·판정 창·judgedAt)·상태 스토어·서비스·모듈(3.4) + AI 결과 REST(4.6 — 점수 재검증의 구멍까지 재현, 게스트는 `user_id` NULL) 이식·배선 완료. **프론트 e2e:real 미검증** · 실 MySQL 3건 미실행 |
| 음성 시그널링·ICE | `handler/`(voice), `ws/voice/` | voice.md | ✅ voice.join/leave/signal 릴레이·명단·정리 순서·`GET /voice/ice`(coturn HMAC) 이식 완료(1.7) |
| 소셜 로그인·프로필 | `auth/`, `user/` | auth.md | 🚧 소셜 로그인 이식 완료(4.2 — authorize/callback/session/me/logout, state·로그인 코드 1회용, kakao·google, 가입 경합 재조회). MySQL 통합 6건은 `MYSQL_TEST_URL` 부재로 **미실행**. 프로필은 4.3 |
| 전적·주간 랭킹 | `game/match/`, `game/ranking/` | persistence.md | 🚧 MySQL 풀·Flyway 호환 러너(4.1) + 전적 보관(4.4 — 멱등·닉네임 우선순위·users로 회원 판정) + 주간 랭킹(4.5 — KST 경계·집계·캐시·REST) 이식 완료. **MySQL 집계·저장 통합 22건은 `MYSQL_TEST_URL`·docker 부재로 미실행 — SQL 문법조차 미검증**. 배선 완료 |
| 모니터링·배포 | `monitoring/`, Jenkinsfile | operations.md | 🚧 게이지 2종 이식·배선 완료(5.3 — `prom-client` 없이 텍스트 노출, 16건) + 배포 전환(5.1 — Dockerfile arm64 크로스 빌드·compose 전체 스택·GHA+GHCR, [ADR-0006](docs/adr/0006-github-actions-ghcr-arm64-single-host.md)). **이미지 실빌드·arm64 실기동·MySQL 통합 48건 미검증** |
| ~~GameAbortService~~ | `game/round/application/` | game-modules.md | 🗑 데드 코드 — 이식 안 함 |

⬜ Java에만 있음 · 🚧 이식 중 · ✅ 이식 완료(테스트 포함) · 🗑 이식 불필요(사유 기록)

## 작업 워크플로우 (티켓 단위)

모든 이식 티켓은 [AGENTS.md](AGENTS.md)의 **Understand → Implement → Reconcile**
사이클을 따른다. 요약:

```text
1. DESIGN.md + 해당 docs/design/*.md 읽기 (티켓 표의 "근거 문서")
2. backend-java 대응 구현과 테스트 읽기 (테스트 = 동작 명세)
3. 구현 + 티켓 표의 "이식할 테스트"를 vitest로 이식
4. 발견사항 → IMPLEMENTATION_NOTES.md (설계 문서와 다르면 문서를 고친다)
5. diff를 DESIGN.md와 대조, 필요 시 문서 갱신·ADR 추가
6. 이 문서의 체크리스트·상태 표 갱신
```

## 리스크

- **Lua 스크립트 포팅.** 원자성 시맨틱과 반환 코드가 계약이다 — 스크립트는
  가능한 한 그대로 옮기고(ioredis `defineCommand`), 동시성 통합 테스트
  (동시 제출 16건·완료 8건·동일 변이 2건 등)를 함께 이식한다. 키 이름을
  스크립트 안에서 조립하는 부분은 단일 Redis 노드 전제 — 그대로 유지.
- **타이머·스케줄러.** 마감 슬롯 선등록 레이스(과거 실사고), 세대 가드, 25s+1s
  유예, 발화-취소 경합은 전부 테스트로 고정돼 있다 — 테스트부터 이식한다.
  프로세스 재시작 시 마감 유실은 StaleRoomCleaner가 임시 방어다(타이머 복구는
  범위 밖, 만들면 Cleaner 삭제).
- **통합 테스트 인프라.** Java는 Testcontainers(redis 7.4, mysql 8.0)다. Node
  쪽 대응(테스트 전용 compose vs testcontainers-node)을 Phase 1.1에서 정하고
  ADR로 남긴다. Redis 의존 계약(Lua·TTL·동시성)은 모킹으로 검증할 수 없다.
- **단일 프로세스 제약.** WS 구독·타이머·폐쇄 예약·랭킹 캐시가 인메모리다
  (Java와 동일). 수평 확장은 범위 밖 — 필요해지면 별도 ADR.
- **오류 표면의 비일관성이 계약이다.** plain-text 코드 문자열, API마다 다른
  401 본문, START 실패 사유 뭉개짐 등을 "개선"하고 싶은 유혹을 참는다 —
  프론트가 문자열 단위로 매핑한다. 계약 정리는 마이그레이션 완료 후.
- **배포된 dev 서버 ≠ 저장소의 backend-java.** 프론트 e2e 기록(한글 닉네임
  거부 등)에 저장소 코드와 안 맞는 동작이 있다 — 명세는 **이 저장소의**
  backend-java다. e2e:real로 검증할 때 대상 서버 버전에 주의.
