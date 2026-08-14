# PLANS — Java → JS 백엔드 마이그레이션

> 진행 중 변경의 계획서. "시스템이 어떻게 동작하는가"는 [DESIGN.md](DESIGN.md),
> "왜 이 마이그레이션인가"는 [ADR-0001](docs/adr/0001-backend-js-migration.md),
> "왜 이 방식인가"는 [ADR-0002](docs/adr/0002-strangler-wire-contract.md) 참고.
> 각 단계가 끝날 때마다 체크리스트와 상태 표를 갱신한다.

## 목표

`backend-java/`(Spring Boot)의 모든 기능을 `backend/`(Node.js + TypeScript)로
이식하고 운영 트래픽을 전환한 뒤 backend-java를 제거한다.

## 원칙

- **프론트엔드 무변경.** REST·WebSocket 와이어 계약을 동결한다. 마이그레이션이
  끝날 때까지 `frontend/`의 프로덕션 코드는 한 줄도 바뀌지 않아야 한다.
- **backend-java 동결.** 참조 구현으로만 읽는다. 이식 순서와 무관한 운영
  hotfix는 별도 브랜치에서 처리한다.
- **수직 슬라이스.** 레이어 전체를 한 번에 옮기지 않는다. 기능(게임) 단위로
  REST + WS + 상태 + 테스트를 끝까지 옮기고 실제 프론트로 검증한다.
- **테스트가 명세다.** backend-java의 테스트 케이스를 vitest로 함께 이식한다.
  통과하는 테스트 없이 "이식 완료"라고 하지 않는다.
- **동작 차이는 기록 후 결정.** Java 쪽 버그를 발견해도 조용히 고치지 않는다 —
  IMPLEMENTATION_NOTES.md에 기록하고 그대로 이식할지 고칠지 명시적으로 정한다.

## 단계

### Phase 0 — 백본 ✅ (이 PR)

- [x] `backend` → `backend-java` 이동, 파이프라인·문서 경로 갱신
- [x] Node 22 + TS + Fastify + ws + Biome + Vitest 백본
- [x] envelope 파싱, `sys.connected`/`sys.ping`/`sys.pong`, 방 구독 레지스트리
- [x] `GET /actuator/health`, CORS, 환경변수 스킴(backend-java와 동일 이름)
- [x] GameModule 인터페이스·레지스트리 스켈레톤
- [x] 문서 체계: DESIGN.md · AGENTS.md · docs/design · docs/adr · 본 문서

### Phase 1 — 플랫폼 코어

프론트가 로비까지 실제로 동작하는 최소 서버.

- [ ] Redis 연결 배선 및 키 스킴 구현 (rooms-and-sessions.md)
- [ ] 게스트 사용자: `POST /api/v1/users/guests`, 세션 토큰 검증, 24h TTL
- [ ] 방 REST: 생성 / 참가 / 나가기 / 조회(`/lobby` 포함) / 게임 시작(host 검증)
- [ ] 정원·중복 참가 처리 — Redis Lua 원자성 (Java `RoomService` Lua 포팅)
- [ ] WS `room.subscribe` 인증 → `room.snapshot` 응답, REST 변경 후 방 전체 broadcast
- [ ] `reaction.send`, `room.ready`
- [ ] 오류 계약: 401 `invalid_guest_session` · 403 `host_only` · 409 `room_full` 등
- **완료 기준**: 프론트 `dev:real`로 방 생성 → 초대 참가 → 로비 표시까지 동작

### Phase 2 — 게임 프레임워크

게임과 무관한 진행 공통 기반.

- [ ] GameLifecycleService 대응: start/reset/pause/resume/close
- [ ] 라운드 상태·타이머: RoundState, 마감 스케줄러, 타임아웃 해소, 유실 예약 복구
      (Java `fix: 마감 지난 예약이 유실돼 방이 멈추던 레이스` 케이스를 테스트로 이식)
- [ ] 점수 확정: 서버 재계산 + Lua 원자 갱신 (`round.submit` → `score.update` → `round.end`)
- [ ] 재접속 스냅샷: `GameReconnectSnapshotService` 대응 (reconnect.md 불변식)
- [ ] 게임 종료·결과 집계, 방 phase 전이
- **완료 기준**: 프레임워크 단위 테스트 + 야추 없이도 라운드 사이클이 통합 테스트로 검증됨

### Phase 3 — 게임 모듈

기준 게임(야추)부터. 게임 하나 끝날 때마다 프론트 E2E로 검증.

- [ ] `game/yacht/` — 점수 계산(YachtScoreCalculator), 주사위 굴림·킵, 족보 후보
- [ ] `game/duel/` — 석양이 진다 (DuelRules, 신호·판정)
- [ ] `game/pingpong/` — 탁구 (스윙 판정·업링크 지연 보상, AI 결과 처리)
- [ ] 봇 지원(supportsBots) 동작 확인
- **완료 기준**: 게임별로 frontend `npm run test:e2e:real` 통과

### Phase 4 — 계정·기록

- [ ] 소셜 로그인: 카카오·구글 OAuth, 로그인 코드 교환, 상태 저장소
- [ ] MySQL 배선: 기존 Flyway 스키마(V1·V2) 그대로 사용, 마이그레이션 도구 결정(ADR)
- [ ] 전적 보관(MatchArchiveService), 주간 랭킹(WeeklyRankingService)
- [ ] 게임 결과 조회 REST (`/api/v1/games/...`, 랭킹 API)
- **완료 기준**: 소셜 로그인 → 게임 → 전적·랭킹 조회가 실 DB로 동작

### Phase 5 — 운영 전환

- [ ] Dockerfile · compose 통합, `.env` 재사용 확인
- [ ] Jenkinsfile: backend(Node) 빌드·배포 스테이지 추가
- [ ] 모니터링: `/actuator/health` 유지 확인, Prometheus 메트릭 노출 방식 결정(ADR)
- [ ] 부하·재접속 시나리오 검증, 트래픽 전환
- [ ] backend-java 제거 (별도 PR)
- **완료 기준**: 운영 도메인이 Node 백엔드를 서빙하고 한 주간 무회귀

## 상태 표

| 하위 시스템 | Java 위치 | 상태 |
|---|---|---|
| WS 게이트웨이·envelope | `ws/`, `handler/` | 🚧 스켈레톤 (Phase 0) |
| 방·게스트 세션 | `room/`, `user/` | ⬜ Java에만 있음 |
| 라운드·점수 확정 | `game/round/`, `game/domain/` | ⬜ Java에만 있음 |
| 재접속 스냅샷 | `game/round/application/` | ⬜ Java에만 있음 |
| 야추 | `game/yacht/` | ⬜ Java에만 있음 |
| 석양이 진다 | `game/duel/` | ⬜ Java에만 있음 |
| 탁구 | `game/pingpong/` | ⬜ Java에만 있음 |
| 소셜 로그인 | `auth/` | ⬜ Java에만 있음 |
| 전적·주간 랭킹 | `game/match/`, `game/ranking/` | ⬜ Java에만 있음 |
| 음성 시그널링 | `ws/voice/` | ⬜ Java에만 있음 |
| 모니터링 | `monitoring/` | ⬜ Java에만 있음 |

⬜ Java에만 있음 · 🚧 이식 중 · ✅ 이식 완료(테스트 포함) · 🗑 이식 불필요(사유 기록)

## 작업 워크플로우 (티켓 단위)

모든 이식 티켓은 [AGENTS.md](AGENTS.md)의 **Understand → Implement → Reconcile**
사이클을 따른다. 요약:

```text
1. DESIGN.md + 해당 docs/design/*.md 읽기
2. backend-java 대응 구현과 테스트 읽기 (테스트 = 동작 명세)
3. 구현 + backend-java 테스트를 vitest로 이식
4. 발견사항 → IMPLEMENTATION_NOTES.md
5. diff를 DESIGN.md와 대조, 필요 시 문서 갱신·ADR 추가
6. 이 문서의 체크리스트·상태 표 갱신
```

## 리스크

- **Lua 스크립트 포팅.** 원자성 시맨틱이 계약이다 — 스크립트는 가능한 한 그대로
  옮기고, 동시성 테스트를 함께 이식한다.
- **타이머·스케줄러 차이.** Spring TaskScheduler → Node 타이머 + Redis 기반
  복구. 프로세스 재시작 시 마감 예약 유실 문제는 Java에서 이미 겪었다
  (`OrphanedRoundStateSweeper`) — 같은 방어를 처음부터 설계에 넣는다.
- **단일 프로세스 제약.** WS 구독이 인메모리이므로 현재 구조는 단일 인스턴스
  전제다(Java와 동일). 수평 확장은 이 마이그레이션의 범위가 아니다 — 필요해지면
  별도 ADR.
- **동작 미기록 영역.** GAME_SESSION_INTEGRATION.md가 다루지 않는 세부 동작은
  Java 코드·테스트가 유일한 명세다. 이식하며 발견하는 대로 docs/design에 기록한다.
