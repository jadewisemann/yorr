# 실시간 아키텍처와 세션 복구

## 메타데이터

| 항목 | 내용 |
|---|---|
| 키워드 | WebSocket, 세션 FSM(파생 상태), heartbeat, 재접속 복구, server-authoritative, 스냅샷 병합, SSOT 계약 |
| 핵심 커밋 | `7ceb700`(heartbeat 생존 판정, FE+BE) · `c0b556c`(sessionToken 재접속 복원, FE+BE) · `a6b6301`(복귀 확인 UX) · `5659ecf`(localStorage 40분 영속화) · `f53ca6a`(오프라인 턴 스킵·자동 퇴장, FE+BE) |
| 코드 | `src/realtime/` · `src/app/RealtimeSync.tsx` · `src/room/sessionFsm.ts` — 상세는 [위키: realtime](../wiki/realtime.md) · [room-and-session](../wiki/room-and-session.md) |

## 문제

모바일 브라우저는 백그라운드 전환·화면 잠금·터널에서 수시로 끊긴다. 끊긴 사람의 턴이
방 전체를 멈추게 하면 안 되고, 돌아온 사람은 점수판·굴림 진행·킵 상태를 그대로 이어받아야
한다. 브라우저를 껐다 켜도 진행 중이던 방으로 돌아갈 수 있어야 한다.

## 설계 결정

1. **세션 상태는 저장하지 않고 파생한다.** `sessionPhaseOf(roomSession, roomSnapshot)`
   순수 함수가 FSM(`idle→joining→inLobby⇄inGame→finished`)을 계산한다 — 별도 상태를
   저장하면 두 소스가 어긋나는 순간 유령 세션이 생긴다. 종료 전이는 `endSession(reason)`
   단일 경로로 모으고, 이유(5종)마다 안내 문구가 다르다.
2. **전송과 정책을 분리했다.** `realtimeClient`는 재연결·heartbeat·큐가 없는 멍청한
   전송이고, 정책(1초×10회 재연결, 서버 지정 주기 heartbeat, 메시지→store 리듀서)은
   `RealtimeSync` 한 곳에 있다 — 전송을 `FakeRealtimeClient`로 갈아끼우면 정책까지
   통째로 테스트된다.
3. **재접속 = `room.join` + 서버 측 정체성 복원.** 클라는 저장된 `sessionToken`으로 다시
   join하고, 서버(직접 구현한 `RoomSessionRegistry`/`HeartbeatMonitor`)가 기존 정체성을
   찾아 `sys.reconnected{snapshot}`으로 전체 상태를 내려준다. 같은 플레이어의 옛 소켓은
   교체 종료(1인 1세션). heartbeat 3주기 무응답이면 서버가 퇴장 처리 — "ping이 멈추면
   게임 중 강제 퇴장"이므로 클라 heartbeat는 서버가 내려준 주기로만 돈다.
4. **스냅샷 병합 불변식(`keepGameState`).** 서버 전체 스냅샷에는 게임 진행 상태가 없을
   수 있다 — 그대로 갈아끼우면 `score.update`로 모아온 전 플레이어 점수판이 사라진다.
   phase·로컬 game 유무에 따른 4규칙으로 병합하고, 같은 규칙을 REST 백필 쪽
   (`preserveRealtimeGame`)에도 적용해 "REST 응답이 game.over를 덮어 결과 화면이 영영 안
   뜨는" 실측 레이스를 막았다.
5. **복원은 자동 입장하지 않는다.** 방 세션을 localStorage에 `{session, expiresAt}`
   봉투로 40분(서버 방 TTL과 동일, sliding) 저장하되, 복원 시 랜딩의 복귀 배너에서
   사용자가 "이어서 하기"를 고른 뒤에만 토큰을 서버에 제시한다. 재연결 10회 소진도
   토큰을 지우지 않고 "다시 연결" 확인 상태로 멈춘다.
6. **끊긴 사람이 방을 멈추지 못하게** — 오프라인 턴 즉시 스킵, 2턴 연속 오프라인 자동
   퇴장, 명시적 퇴장 즉시 제거(FE+BE). 퇴장 REST가 실패해도 로컬은 반드시 정리한다 —
   요청 실패가 사용자를 방에 가두면 안 된다.

FE/BE 경계는 `wsEvents.ts` **공유 와이어 계약(SSOT)** 으로 관리 — Java가 같은 type
문자열로 DTO를 미러링하고, 변경은 이 파일을 먼저 고친다(v0.1~v1.0 버전 히스토리).

## 결과

- 새로고침·브라우저 재시작·네트워크 단절 모두에서 점수판 손실 없이 복귀
- E2E로 잠금: 재접속 6스펙("토큰을 사용자 승인 전에 제시하지 않는다" 포함) + 단절 4스펙
- 중복·역순 메시지 내성(mock 시나리오로 테스트 가능), `msgId` 상관관계로 요청-실패 매칭

## 예상 꼬리 질문

- **왜 지수 백오프가 아닌가?** 고정 1초×10회. 모바일 단절은 터널·잠금처럼 짧고 균일해서
  백오프는 복귀만 늦춘다. 10회 소진 시 사용자 확인 상태로 전환하는 쪽이 UX가 낫다.
- **diff(state.patch) 대신 전체 스냅샷?** 2~6인 규모라 diff 비용이 없고, 메시지 하나를
  놓쳐도 다음 스냅샷에서 자동 복구된다. 킵 동기화도 같은 이유로 전체 배열.
- **왜 40분 TTL?** 방 자체가 Redis에서 40분 TTL — 더 길면 "이어서 하기 → 방 없음" 실패만
  만든다. 로그인 세션(30일)과 저장소를 분리해 방을 나가도 로그인이 풀리지 않는다.

## 활용 포인트

- "모바일 WebSocket 세션의 수명주기를 파생 상태 FSM으로 설계하고, heartbeat 생존
  판정부터 sessionToken 복원까지 서버(Java) 측을 직접 구현해 끝단 간 복구를 완성"
- "스냅샷 병합 불변식을 WS/REST 양쪽에 대칭으로 적용해 메시지 순서 레이스로 인한 상태
  손실을 구조적으로 제거"
