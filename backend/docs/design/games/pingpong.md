# 탁구 (PING_PONG)

> 프레임워크 공통은 [game-modules.md](../game-modules.md).
> 구현은 `src/game/pingpong/`(아래 「구현」).
> min 2 / max 2 / supportsBots **false** — 그 세 값의 출처는 `game/catalog.ts`
> 하나이고 모듈은 다시 선언하지 않는다. duel과 같은 자체 상태기계 + 버전 키
> 스케줄링 패턴.

**[DESIGN.md](../../../DESIGN.md) 원칙 2(「물리는 연출이다」)가 이 게임에서 가장
날카롭다**: 클라이언트가 보내는 것은 `swing{inputSeq, clientTs}` 하나뿐이고
공의 위치·속도·판정·좌우 목표점은 전부 서버가 만든다. 클라이언트가 계산한
궤적이나 히트 판정을 상태에 반영하는 경로는 **존재하지 않는다.** 서버가 프레임을
보내지 않고도 같은 공이 그려지는 것은 궤적이 해석적(틱 없음)이기 때문이다.

## WS 메시지 (접두사 `game.ping_pong.`)

- 인바운드: `swing {inputSeq:long, clientTs:long}`(위치·파워 없음 — 타이밍이
  전부다), `ready {}`(payload 파싱 안 함).
- 아웃바운드: `game.ping_pong.state`(payload가 **PingPongState 그대로**),
  `game.ping_pong.state.sync`(COUNTDOWN 진입·종료 시에만 snapshot 동봉),
  `game.ping_pong.game.over` + `state.sync`.
- 프론트 리듀서는 `snapshot.gameCode`가 일치할 때만 `game.ping_pong.state`를
  적용한다 — 스냅샷에 gameCode 필수.

## PingPongState

```
version, phase(PREPARING|COUNTDOWN|PLAYING|FINISHED), playerOrder[2],
scores{...}, lastInputSeq{...}, readyPlayerIds[],
ball{pos, direction(±1), speed, smash, fault(OUT|NET|null), faultFrom, x0, x1, launchedAt},
rally, serveReceiverId, nextActionAt,
lastEvent{id(=version), type, playerId, at}
이벤트 타입: READY PRACTICE PLAYER_READY SERVE TOO_EARLY TOO_LATE OK NICE SMASH
             OUT NET POINT GAME_OVER OPPONENT_LEFT
```

## 랠리 시뮬레이션 (1차원 해석적 궤적 — 틱 없음)

- `pos`는 0→1로 player 0 쪽을 향하고, `direction=+1`이 "player 0에게 오는 중".
  현재 위치 = `pos + direction × speed × 경과초`. 좌우(x)는 x0→x1 보간, x1은
  스윙/서브마다 서버 RNG(`0.15~0.85`).
- 판정 창(player 0 기준, player 1은 1-v 미러): 이상점 0.9, 유효 창
  [0.72, 1.06], 1.1 지나면 실점. 창 밖 스윙 = TOO_EARLY/TOO_LATE 이벤트만 내고
  **공은 그대로 날아간다**(헛스윙).
- 창 안: 이상점과의 거리 ≤0.06 → SMASH(속도 1.95), ≤0.1 → NICE(1.0), 그 외
  OK(0.82). 더 벗어나면 폴트 — 이르면 OUT, 늦으면 NET(둘 다 공은 되돌아가되
  마감 시 상대 득점). rally는 정상 리턴에만 +1.
- 네트 통과는 항상 궤적 진행률 0.5. 마감 시각은 궤적에서 역산(NET은 0.5
  지점에서 사망, OUT은 테이블 밖 ±0.5).

## 업링크 지연 보상

`판정시각 = max(now-120ms, min(now, clientTs))` — 이상점→네트 밴드 폭이
0.12(정상 속도 기준 120ms)라 업링크 지연이 완벽한 스윙을 네트로 만든다.
미래 timestamp는 now로, 과거는 120ms까지만 롤백(죽은 공을 쳤다고 주장 불가).
알려진 잔여 구멍(클라이언트 시계가 느리면 공짜 롤백)과 개선안(벽시계 대신
상태 기준 경과시간)은 `pingPongRules.ts` 주석에 있다.

## 준비 게이트·서브·득점

- initial은 PREPARING, `nextActionAt=0`(타이머 없음). PREPARING 중 swing은
  PRACTICE 이벤트(연습 — inputSeq만 기록). **ready는 그 플레이어가 연습 스윙을
  한 뒤에만 유효**(`lastInputSeq>=0`) — "모션 입력이 동작한다"는 핸드셰이크다.
  둘 다 ready → COUNTDOWN(2600ms 후 서브).
- 서브 로테이션: 상태는 **리시버**를 저장. 2점마다 교대, 10:10부터 매 점 교대.
- 11점 선취 + 2점 차 승리(듀스). 만료 판정: 폴트 공은 친 쪽 상대 득점, 무폴트
  방치 공은 안 친 쪽 상대 득점. 득점 후 COUNTDOWN 재진입.
- 이탈: PREPARING 중이면 **게임 자체를 취소**한다(시작도 안 한 매치를 이겼다고
  주지 않는다). 경기 중이면 forfeit(생존자 11점, OPPONENT_LEFT).
- 종료 시 점수 기록·완료는 duel과 동일(`finishIfComplete(force=true)`,
  roster 잔존자만). **점수 기록이 종료 판정보다 먼저다** — `game.over`의 순위가
  최종 점수를 봐야 한다.

### 이탈 시퀀스 (순서가 계약이다)

`removePlayer`는 phase를 **먼저 읽는다** — 상태를 지운 뒤에는 PREPARING이었는지
알 수 없다. 그 다음은 두 갈래로 갈리며 각 단계의 순서까지 테스트가 고정한다
(`__tests__/pingPongGameService.test.ts`).

| # | PREPARING 이탈 (매치 취소) | 경기 중 이탈 (몰수) |
|---|---|---|
| 1 | `presence.removePlayer` | `presence.removePlayer` |
| 2 | `rooms.leave` | `rooms.leave` |
| 3 | `room.player_left` 방송 | `room.player_left` 방송 |
| 4 | `scheduler.cancelRoom` | forfeit 변이 → `scheduler.cancelRoom` |
| 5 | `states.remove` | 최종 점수 기록(roster 잔존자만) |
| 6 | **`rooms.cancelActiveGame`**(CANCEL_ACTIVE_GAME Lua) | `finishIfComplete(force=true)` |
| 7 | `markPhase('waiting')` | `game.ping_pong.state` 방송 |
| 8 | `game.ping_pong.state.sync` 방송 | `game.ping_pong.state.sync` 방송 |

- `room.player_left`는 **게임 네임스페이스가 붙지 않는다**(방 이벤트 — 2.5와 같은 규칙).
- 3단계는 "좌석이 실제로 빠졌거나 방에서 빠졌을 때"만 나간다(멱등 재이탈에서 두 번
  쏘지 않는다).
- 취소 경로만 `cancelActiveGame`을 부른다. 로비 복귀(`reset`)는 이미 FINISHED라
  되돌릴 gameId가 없다 — 여기서 부르면 진행 중인 다른 게임을 건드릴 수 있다.
- 취소 경로에서는 점수를 쓰지 않고 종료 판정도 하지 않는다.

## 저장·스케줄링

duel과 동일 패턴: `RedisPingPongStateStore` SETNX init
(`ping_pong_already_initialized`), 5초 락, 방 TTL 복사, version 비증가 변이는
무시. 스케줄러 키 = version; COUNTDOWN 타임아웃 → serve, 그 외 → expire.
**마감이 이미 지난 예약(delay 0)이 흔한 게임**이라 스케줄러의 슬롯 선등록
규칙이 특히 중요하다([game-modules.md](../game-modules.md)의 레이스 회귀).

- 락은 `SET NX PX 5000` + 10ms 스핀(2초 상한, 초과 시 `game_state_busy`)이고
  해제는 **내 토큰일 때만** 지우는 Lua(`PING_PONG_STATE_SCRIPTS`)다. Node가 단일
  스레드라도 `await` 사이에 같은 방의 다른 스윙·마감이 끼어들 수 있어 "읽기 →
  변이 → 쓰기"를 직렬화해야 같은 공을 두 번 리턴하지 않는다.
- 스케줄러의 두 번째 인자는 라운드 번호가 아니라 **version**이다(1부터 증가하므로
  `roundNumber >= 1` 검증을 그대로 통과한다). 발화 시점의 version이 예약 시점과
  다르면 마감은 아무것도 하지 않는다.
- 고아 상태 스위퍼는 야추 상태만 SCAN하므로 **탁구는 청소하지 않는다** — 상태는
  방 TTL 복사로, 죽은 예약은 version 체크로 방어한다
  ([game-modules.md](../game-modules.md)의 quirk).
- `fault`·`serveReceiverId`·`lastEvent`는 없으면 **필드 자체가 생략**된다` = TS의 `undefined`). 역직렬화에서 `null`이 섞여
  들어와도 `undefined`로 정규화한다 — 그러지 않으면 다시 쓸 때 `"fault":null`이
  새로 생겨 와이어 계약이 조용히 달라진다.

## 구현 (`src/game/pingpong/`)

| 파일 | 역할 |
|---|---|
| `pingPongState.ts` | 상태·공·이벤트 타입(와이어 모양 그대로) |
| `pingPongRules.ts` | **순수 함수만** — 궤적·판정 창·`judgedAt`·서브 로테이션·득점·몰수 |
| `pingPongPorts.ts` | 바깥 계층(브로드캐스터·레지스트리·스케줄러·스냅샷·종료·방·점수 기록)의 좁은 포트 + 상태 저장소 포트 |
| `pingPongStateStore.ts` | Redis 어댑터(SETNX·방 락·TTL 복사·unlock Lua) |
| `pingPongScoreWriter.ts` | 종료 시 `room:{code}:scores` 기록(roster 필터) |
| `pingPongGameService.ts` | 진행 순서의 권위(방송·스냅샷 동봉·취소 시퀀스) |
| `pingPongGameModule.ts` | `GameModule` 구현 — 라우팅(`swing`·`ready`)·멤버십 검증·오류 응답 |
| `index.ts` | 공개 표면(배럴). 배선과 4.6은 여기만 import한다 |

- **협력자 일곱을 전부 좁은 포트로 뒤집었다**(2.5 `roundPorts.ts`·2.7
  `completionPorts.ts`와 같은 이유). `RoomBroadcaster`·
  `RoomSessionRegistry`·`RealtimeRoomSnapshotService`·`RoundDeadlineScheduler`·
  `GameCompletionService`·`StringRedisTemplate`·`RoomValidationService`를 구체
  타입으로 잡는다. 실제 구현이 어댑터 없이 구조적으로 만족하며 그 대입 가능성은
  `__tests__/pingPongPorts.contract.test.ts`가 고정한다.
- 방 스냅샷 타입은 **제네릭**이다(`PingPongGameService<S>`) — 스냅샷의 모양은
  ws 소유이고 탁구는 `game` 하나를 얹을 뿐이다(2.8 `PhasedRoomSnapshot`과 같은 경계).
  모듈이 `S = WsRoomSnapshot`으로 고정해 `GameModule.reconnect` 계약을 만족시킨다.
- **시계와 좌우 RNG는 주입 가능한 시임**(`now`·`randomTarget`)이다. 전역 시계와
  전역 난수를 직접 부르면 판정 시각 테스트가 실시간에 묶인다 — 시임 덕에 sleep도
  가짜 타이머도 쓰지 않는다.
- `start()`가 `markPhase('playing')`을 부르는 자리다(3.1·3.3과 같은 계약).
  빠지면 진행 중 방의 소켓이 끊길 때 offline이 아니라 player_left가 된다.

## AI 결과 (REST — 멀티플레이 파이프라인과 무관)

로컬 싱글플레이(온디바이스 AI) 결과를 클라이언트가 직접 보고한다.
이식 완료(4.6): `game/pingpong/aiResultService.ts` + `http/routes/pingPongAi.ts`.

`POST /api/v1/games/ping-pong/ai-results` · 본문 `{resultId(UUID), humanScore, aiScore}`
· 성공 **204**(본문 없음).

서버가 이 판의 랠리를 하나도 보지 못했으므로, DESIGN.md 원칙 1(서버 권위)을 지키는
수단은 **보고된 점수를 규칙으로 다시 확인하는 것** 하나뿐이다. 그래서 이 경로는
게임 상태·스토어·모듈·완료 서비스를 전혀 건드리지 않고 3.4에서 `WIN_SCORE`만
가져온다(`game/pingpong/index.ts`).

### 점수 재검증 — 그리고 그 한계

`invalid_final_score`의 조건은 세 가지다: 음수 없음 · 이긴 쪽이 `WIN_SCORE`(11) 이상 ·
**2점차 이상**. `10:7`·`11:10`·`-1:11`이 여기서 걸린다.

⚠️ **이 검증은 "끝날 수 있는 스코어라인"만 본다.** `50:3`·`12:9`처럼 11점에서 이미
끝났어야 하는 값은 통과한다(듀스가 12:10·13:11…로 올라가므로 상한을 못박을 수 없다).
알려진 구멍이며 조용히 조이지 않았다 — 와이어 계약을 바꾸는 일이고, 조이려면
프론트가 실제로 보내는 값의 실측이 먼저다. 대신 이 경로로 부풀린 점수가 주간 랭킹에
오르지는 않는다: 랭킹 질의는 게임 코드로 필터한다(`game/ranking/`).

### 게스트 / 회원 분기

`Authorization`이 **선택인 유일한 REST**다. 로그인 없이 할 수 있는 싱글플레이라
헤더가 없다는 것은 오류가 아니라 "게스트다"라는 뜻이다. 반대로 헤더가 **있는데 모양이
틀리면 401**이다 — 토큰을 들고 왔다는 것은 자기 전적으로 남기려는 의도이고, 조용히
게스트로 떨어뜨리면 그 기록은 주인을 잃는다. 빈 문자열·공백 헤더는 "안 보낸 것"이다.

- 세션 없음 → `playerId`를 **임의 UUID**로, 닉네임 `"게스트"`로 보관한다.
- 세션 있음 → 그 세션의 `userId`·닉네임으로 보관한다. **회원/게스트 세션을 가르지
  않는다** — 회원 판정은 4.4가 `users` 테이블 존재 여부로 한다(`matchArchiveStore.ts`).
  세션 타입으로 가르면 세션이 만료된 회원의 전적이 주인을 잃는다.
- 그 결과 **게스트의 전적은 남지 않는다**: 임의 UUID도 게스트 userId도 `users`에 없어
  `match_participants.user_id`가 NULL이 되고, 주간 랭킹 질의(`JOIN users` /
  `user_id IS NOT NULL`)가 그 행을 통째로 뺀다. AI(`playerId="ping-pong-ai"`,
  닉네임 `"AI"`)도 같은 이유로 언제나 NULL이다.

보관은 `MatchArchiveService.archiveParticipants({gameId: resultId, gameCode: PING_PONG,
roomCode: "LOCAL_AI"})`. `resultId`는 **클라이언트가 만드는 UUID**이고 그대로
`matches.game_id`가 되므로, 그 컬럼의 UNIQUE 제약이 재전송·새로고침에 대한 멱등의
전부다. 이미 보고된 판이면 보관은 false를 돌려주지만 **응답은 그래도 204**다(실패가
아니다).

### 오류 계약 (plain-text — 프로필·auth·랭킹과 같은 결)

| 상황 | 응답 |
|---|---|
| `resultId`가 UUID가 아님·없음 | 400 `invalid_result_id` |
| 규칙으로 끝날 수 없는 점수 | 400 `invalid_final_score` |
| 본문 없음 | 400 `invalid_ai_result` |
| 읽을 수 없는 본문(깨진 JSON·점수가 숫자 아님) | 400 + **빈 본문** |
| `Authorization` 형식 위반 · 죽은 토큰 | 401 `session_expired` |

- 본문은 **JSON이 아니라 문자열 코드**다(조회 REST(2.9)의 `{code,message}`가 아니다).
  401 문자열은 퀵매치의 `unauthorized`도 방 REST의 `invalid_guest_session`도 아닌
  **`session_expired`** 다 — 프론트가 본문을 텍스트로 읽어
  대문자 코드로 매핑한다. 라우트마다 다른 이 문자열들이 계약이므로 섞지 않는다.
- 검증 **순서**가 계약이다: resultId 먼저, 점수 나중. 둘 다 틀리면 `invalid_result_id`.
- 읽을 수 없는 본문의 400이 빈 본문인 이유는 `gameQueries.ts`의 score-candidates와
  같다 — 프레임워크가 만드는 `{timestamp,status,...}`는 계약이 아니다.
- **본문 없는 POST도 핸들러까지 들어와야 한다**.
  Fastify 기본 JSON 파서는 그 전에 400을 던지므로, 라우트가 **자기 하위 스코프에서만**
  파서와 오류 핸들러를 갈아 끼운다(캡슐화 — 같은 `/api/v1`의 방·퀵매치 REST에는 영향이
  없고, 테스트가 그 격리를 못박는다).

### 이식한 테스트

| 파일 | 덮는 것 | MySQL |
|---|---|---|
| `game/pingpong/__tests__/aiResultService.test.ts` | 점수 재검증·보관 인자·순위·UUID 정규화·본문 바인딩 | 불필요 |
| `http/routes/__tests__/pingPongAi.test.ts` | REST 계약·오류 표면·파서 캡슐화(세션은 진짜 Redis) | 불필요 |
| `game/pingpong/__tests__/aiResultArchive.test.ts` | `game_id` UNIQUE로 중복 보고 차단 · 게스트 행의 `user_id` NULL | **필요**(`MYSQL_TEST_URL` 없으면 skip) |

## 이식할 대표 테스트

judgedAt 3분기(과거 클램프·미래 클램프·120ms 캡) / 이상점 스매시 + 중복
inputSeq 무시 / 실점 시 상대 득점·서브 유지(2점 규칙) / 서브 로테이션 표
(0:0→10:10→듀스) / 듀스 2점차 종료 / 이탈 forfeit / **연습→ready 게이트**
(연습 전 ready는 동일 상태 반환) / PREPARING 이탈 시 취소 시퀀스(브로드캐스트
2건 순서까지) / AI 결과: 불가능 점수 거부·UUID 검증·게스트/회원/잘못된 헤더
분기.

이식 현황(3.4, AI 결과 제외):

| 파일 | 덮는 것 |
|---|---|
| `__tests__/pingPongRules.test.ts` | 규칙 **7종**(위 목록의 규칙 항목) |
| `__tests__/pingPongGameService.test.ts` | 취소 순서 + 시작/몰수/서브 마감/스테일 예약/판정 시각 |
| `__tests__/pingPongGameModule.test.ts` | 라우팅·멤버십 검증·오류 매핑 |
| `__tests__/pingPongPorts.contract.test.ts` | 좁은 포트 ↔ 실제 구현 대입 가능성 |
| `__tests__/redisPingPongStateStore.test.ts` | 진짜 Redis: SETNX·TTL 복사·version 비증가 무시·동시 변이·NON_NULL |

**시간 판정 테스트는 실시간 sleep을 쓰지 않는다.** 규칙은 시각을 인자로 받고,
서비스는 `now` 시임을 받고, 마감 예약은 `DeadlineExecutor`를 테스트가 직접
발화시킨다. ⚠️ 인라인(즉시 실행) executor는 **쓸 수 없다** — 탁구는 서브 → 실점
→ 카운트다운 → 서브가 끝없이 이어지므로 지연을 무시하면 무한 루프가 된다.
