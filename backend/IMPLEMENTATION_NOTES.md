# IMPLEMENTATION NOTES — working memory

> 작업 중 발견한 숨은 불변식·제약·edge case·실패한 접근을 날짜와 함께 적는
> **휘발성 메모**다. 영구 지식으로 판정된 항목은 DESIGN.md(또는 docs/design·ADR)로
> 승격하고 여기서 지운다. 규칙은 [AGENTS.md](AGENTS.md) 참고.
>
> 형식: `## YYYY-MM-DD - 주제` 아래에 불릿. 최신이 위.

## 2026-08-14 - 설계 문서 상세화 (backend-java 전수 분석)

- **GAME_SESSION_INTEGRATION.md는 명세가 아니다.** 실제 계약과 프로토콜이
  다르다(`room.subscribe`/`room.snapshot`/`POST /users/guests`/`POST
  /rooms/{code}/players`는 존재하지 않음). Phase 0 설계 문서가 이 문서를
  기반으로 작성돼 있던 것을 코드·테스트·`wsEvents.ts` 기준으로 전면 교정했다.
  backend-java 제거 시(P5) 이 문서도 같이 지운다.
- **envelope 관용 범위 확정**(Phase 0의 미해결 항목): Java는 알 수 없는 필드
  무시, `ts`는 nullable로 받고 사용하지 않음, payload는 raw JSON. 단 `type`
  필드가 없으면 NPE(오류 응답 없음). **결정: NPE quirk는 재현하지 않는다** —
  Node는 `type` 부재를 `INVALID_MESSAGE`로 처리(realtime.md에 기록). 현재
  zod 스키마가 `ts`·`payload`를 필수로 요구하는 것은 실제 클라이언트(항상
  둘 다 전송)와 호환 — 유지.
- **배포된 dev 서버 ≠ 저장소 backend-java.** 프론트 e2e 하네스가 "실서버는
  한글 닉네임을 400 invalid_nickname으로 거부"라고 기록했지만, 저장소의
  `UserService.normalizeNickname`은 trim 후 1~20자만 검증한다(한글 허용).
  배포 서버가 구버전인 것으로 추정 — 명세는 저장소 코드다. Phase 1 e2e:real
  검증 시 대상 서버 버전 주의(PLANS.md 리스크에도 기재).
- Phase 0 스켈레톤과 Java의 어긋남 두 곳, Phase 1·2에서 정렬 필요:
  ① `ws/registry.ts`가 room.subscribe 모델 기준 → room.join 계약으로 재작업,
  ② `game/module.ts`의 GameModule 시그니처(`start(roomId)` 등)가 Java와 다름
  (`start(roomCode, game)`·`reconnect→스냅샷` — game-modules.md 표가 정본).
- 야추 `dice.broadcast`의 `held`는 사람 굴림일 때 **클라이언트가 보낸 값의
  에코**다(서버 상태가 아니라). autoRoll만 서버 activeHeld를 쓴다 — 이식 시
  헷갈리기 쉬운 비대칭이라 메모.
- Java 테스트 스캐폴딩 중 재사용 가치가 큰 것: `GameWebSocketHandlerTest`의
  메시지 빌더들(정본 와이어 예제), `FakeRoomCloseScheduler`(유예 동기 실행),
  `InMemoryRoundDeadlineSchedulerTest`의 인라인 executor(레이스 재현).

## 2026-08-14 - Phase 0 백본

- `.env` 로딩은 dotenv 대신 Node 22 내장 `process.loadEnvFile()` 사용. 파일이
  없으면 던지므로 `existsSync` 가드를 둔다.
- biome은 프론트 설정을 따르되 `lineEnding`만 `lf`로 했다(서버는 Linux 컨테이너
  전제). 프론트는 `crlf`를 쓴다.
