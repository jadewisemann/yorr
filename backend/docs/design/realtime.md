# 실시간 통신 (WebSocket)

> 상위 원칙은 [DESIGN.md](../../DESIGN.md). 와이어 계약의 정본은
> `frontend/src/realtime/wsEvents.ts`(프로토콜 버전 1). 이 문서는 서버가 구현해야
> 하는 동작을 backend-java(`handler/GameWebSocketHandler`, `ws/*`)와 프론트 소비
> 코드(`app/RealtimeSync.tsx`) 기준으로 기술한다.

## 엔드포인트

- 경로 `/ws/v1/game`, raw WebSocket(SockJS 없음), 핸드셰이크 인증 없음.
- 허용 출처는 REST CORS와 **같은** `CORS_ALLOWED_ORIGINS` 목록(정확 일치, 패턴 아님).
  Origin 헤더가 **없으면 통과**시키고(브라우저가 아닌 클라이언트), 있으면 목록에
  정확히 있어야 한다 — 아니면 핸드셰이크를 403으로 거절한다(Spring
  `OriginHandshakeInterceptor`와 같은 규칙).
- 인바운드 메시지 상한 **64KB**. Java는 서블릿 컨테이너 기본값(Tomcat 텍스트 버퍼
  8KB)에 기대고 아무것도 정하지 않았지만 `ws`의 기본값은 100MB다. 가장 큰 메시지는
  재접속 스냅샷(수 KB)이므로 그 위로 넉넉히 잡았다. 초과 프레임은 close
  1009로 끊긴다.
- **소켓 하나의 메시지는 직렬로 처리한다.** 아래 `room.join`의 처리 순서가 계약인데
  Redis 호출을 기다리는 사이 다음 메시지가 끼어들면 그 순서가 깨진다. Java는
  세션당 한 스레드라 자연히 보장되던 성질이다.

## Envelope

```ts
// 인바운드 (클라이언트 → 서버)
{ type: string, ts: number, payload: unknown, roomId?: string, msgId?: string }
// 아웃바운드 (서버 → 클라이언트) — roomId/msgId는 null이면 필드 자체를 생략
{ type: string, ts: number, payload: unknown, roomId?: string, msgId?: string }
```

- `ts`는 **클라이언트가 채운다**(`Date.now()`). 서버는 파싱만 하고 읽지 않는다.
  아웃바운드 `ts`는 서버가 `Date.now()`로 채운다.
- 알 수 없는 envelope 필드는 무시한다.
- envelope 파싱 실패 → `error{INVALID_MESSAGE, refMsgId:null}` 전송, 연결 유지.
  payload 파싱 실패 → 핸들러별 `error{INVALID_MESSAGE, refMsgId:<msgId>}`.
- **envelope `roomId`의 역할**: 최상위 핸들러(`sys.*`·`room.*`·`reaction.*`·`chat.*`)는
  무시한다(`room.join`은 payload의 roomId를 쓴다). 반면 **게임 네임스페이스
  메시지는 envelope roomId가 세션의 방과 일치해야 하며**, 불일치 시 `NOT_IN_ROOM`이다.
- `msgId`: 요청-응답 상관관계. 서버가 에코해야 하는 곳이 정해져 있다(아래
  카탈로그의 "msgId" 열). 특히 `round.submit`→`score.update` 에코가 없으면
  프론트의 제출 흐름이 완결되지 않는다.
- Java 세부: `ts`는 nullable로 파싱되고 사용되지 않는다. `type` 필드가 없는
  JSON은 Java에서 NPE가 난다(오류 응답 없이 로그만) — 이 quirk는 **재현하지
  않는다**. Node는 `type` 부재를 `INVALID_MESSAGE`로 처리한다(IMPLEMENTATION_NOTES
  2026-08-14 결정).

## 연결 수명

```text
connect
  → 서버가 즉시 sys.connected {serverTs, protocolVersion:1, heartbeatIntervalMs:30000}
  → 클라이언트가 30초 간격 sys.ping {clientTs}  (서버는 payload를 읽지 않는다)
  → 서버가 sys.pong {serverTs}
  → 90초(3회 미스) 동안 ping이 없으면:
      sys.disconnect {reason:"idle_timeout"} 전송 → close 1008
```

- 상수: `PROTOCOL_VERSION=1`, `HEARTBEAT_INTERVAL_MS=30_000`,
  `HEARTBEAT_TIMEOUT_MS=90_000`(간격×3). 서버는 먼저 ping을 보내지 않는다 —
  클라이언트가 `sys.connected`를 받고서야 하트비트를 시작하므로, **재연결마다
  `sys.connected`를 다시 보내는 것이 필수다**(안 보내면 클라이언트 하트비트가
  영원히 시작되지 않는다).
- 하트비트 감시는 세션별 마지막 ping 시각을 CAS로 제거 후 종료 콜백을 실행한다
  — 동시에 도착한 ping이 이기면 세션은 살아남는다. 경계는 정확히 90_000ms
  이상이다(89_999는 생존).
- 서버가 소켓을 닫는 경우는 두 가지뿐이고 둘 다 close code **1008**:
  하트비트 타임아웃(`idle_timeout`), 재접속으로 인한 이전 소켓 교체
  (`replaced_by_new_session`). `DisconnectReason`의 나머지 값
  (`server_shutdown`·`kicked`·`protocol_error`)은 선언만 있고 쓰이지 않는다.

## 인증·구독: `room.join`

브라우저 WebSocket은 커스텀 헤더를 못 붙이므로 **인증은 `room.join` payload로**
한다. `room.subscribe`라는 메시지는 존재하지 않는다.

```json
{ "type": "room.join", "ts": 0,
  "payload": { "roomId": "ABC123", "nickname": "요르", "sessionToken": "..." } }
```

처리 순서(순서 자체가 계약이다):

1. payload 파싱 실패 / `roomId` 공백 → `INVALID_MESSAGE`.
2. Redis에서 방 스냅샷 조회. 없거나 phase가 없으면 → `ROOM_NOT_FOUND`
   (인메모리 유령 방 방지 — 이때 세션은 레지스트리에 **등록되지 않는다**).
3. 레지스트리에 방의 gameCode·phase 기록(LOBBY→`waiting` 매핑).
4. 신원 결정: `sessionToken`이 있으면 토큰 인증(이때 payload nickname은 무시),
   없으면 **새 게스트 생성**(nickname 필수). 토큰 만료 → `SESSION_EXPIRED`,
   닉네임 불량 → `INVALID_MESSAGE`. 두 오류는 구분되어야 한다(회귀 이력 있음).
5. 늦은 참가 차단: phase가 PLAYING인데 기존 좌석이 없으면 → `GAME_ALREADY_STARTED`.
6. **재접속 분기**(같은 playerId의 좌석이 이미 있으면): 좌석·host 플래그를
   유지한 채 소켓만 교체하고, 이전 소켓에 `sys.disconnect{replaced_by_new_session}`
   → close 1008. 새 소켓을 fanout에 등록 후 게임 모듈의 reconnect 스냅샷으로
   `sys.reconnected {snapshot}`(roomId·msgId 에코) 전송, 방 전체에
   `presence.update {playerId, status:"online"}` 브로드캐스트. 스냅샷 생성 실패
   → `INTERNAL` + fanout 등록 해제. 여기서 흐름이 끝난다(`room.joined` 없음).
7. **최초 참가 분기**: ① 본인에게 `room.joined {you, sessionToken, snapshot}`
   (envelope roomId 포함) → ② 방 전체에 `room.player_joined {player}`(본인은
   아직 fanout 미등록이라 못 받는다) → ③ fanout 등록 → ④ 대기 중인 방 폐쇄
   예약이 있었으면 취소하고 라운드 타이머 resume.

주의: WS `room.join`은 Redis 방 멤버십을 바꾸지 않는다. 프론트는 REST
`POST /rooms`로 좌석을 얻은 뒤 join한다. 토큰 없이 join하면 게스트는 생성되지만
Redis 좌석은 없다 — 실전 클라이언트는 이 경로를 쓰지 않는다.

## 구독·브로드캐스트 모델

- 레지스트리(인메모리): `roomId → (playerId → Member{nickname, host, status, session})`,
  세션 역인덱스, 방별 phase·gameCode. 첫 입장자가 host 플래그를 받고
  재입장은 host를 유지한다(진짜 host 권위는 Redis `hostId`다 —
  [rooms-and-sessions.md](rooms-and-sessions.md)).
- 브로드캐스터(인메모리, 레지스트리와 별개 맵): 방별 소켓 집합. **한 번
  직렬화해 같은 프레임을 전 소켓에 재사용**하고, 닫힌 소켓은 건너뛰고, 소켓별
  전송 실패는 삼킨다(한 명의 죽은 소켓이 fanout을 막지 않는다). 소켓별 전송은
  `synchronized(session)` 상당의 직렬화가 필요하다(동시 write 방지) — Node의
  `ws`는 write가 내부 큐라 자연 충족되지만, 직렬화 1회 원칙은 유지한다.
- 여기(인메모리)에는 게임 상태를 두지 않는다 — 상태의 권위는 Redis다.
- REST로 방 상태가 바뀌면 WS 계층이 브로드캐스트한다. 단, 이벤트 종류가
  경로마다 다르다: WS join → `room.player_joined`, 나가기 → `room.player_left`,
  봇 추가/제거(REST) → `state.sync{snapshot}`. 프론트는 어느 쪽이든 로컬 상태를
  갱신/교체할 수 있다.

## 연결 종료 처리 (phase에 따라 다르다)

| 상황 | 레지스트리 | 브로드캐스트 | Redis |
|---|---|---|---|
| 소켓 끊김, phase `PLAYING` | 좌석 유지 + `OFFLINE` 마킹 | `presence.update{offline}` (player_left 아님) | 변화 없음 |
| 소켓 끊김, 그 외 phase | 좌석 제거 | `room.player_left{playerId}` | `user:{id}`의 방 필드만 정리. **방 roster는 그대로**(유예 후 close가 정리) |
| WS `room.leave`, PLAYING | 게임 모듈 removePlayer 경로 | `room.player_left` | `roomService.leave` 호출됨 |
| WS `room.leave`, 그 외 | 좌석 제거 | `room.player_left` | 방 roster 그대로 |

- 끊김 처리 전에 채팅 도배 한도 기록 정리가 먼저다 — 레지스트리에서 세션을 지우면
  소켓만으로는 누구였는지 알 수 없다([chat.md](chat.md)).
- 방의 마지막 소켓이 사라지면: 게임 모듈 `pause`(마감 타이머 즉시 중단 — 빈
  방이 25초마다 자동 진행되는 것을 막는다) 후 **방 폐쇄 예약**. 유예는 phase가
  아니라 `module.hasState()`로 고른다: 게임 상태가 있으면 10분, 없으면 30초.
  근거: 새로고침=끊김+재접속이므로 즉시 닫으면 자기 방을 자기가 부순다.
  40분 방 TTL이 상한이다. 예약 발화 시 빈 방인지 재확인 후
  `module.close` + `roomService.close`.
- 프론트의 실제 나가기는 REST(`DELETE /rooms/{code}/players/me`)다. WS
  `room.leave`는 서버가 구현하지만 프론트 프로덕션 코드는 보내지 않는다.

## 메시지 카탈로그

방향 C→S. 게임별 메시지는 각 게임 문서 참고. "payload 무시"는 파싱조차 안 함.

| type | payload | 비고 |
|---|---|---|
| `sys.ping` | (무시) | `sys.pong{serverTs}` 응답, 하트비트 갱신이 pong 전송보다 먼저 |
| `room.join` | `{roomId, nickname?, sessionToken?}` | 위 절 참고 |
| `room.leave` | (무시) | 프론트 미사용 |
| `room.ready` | `{ready:boolean}` | **서버 상태 저장 없음** — `room.ready_changed{playerId, ready}`를 본인 포함 전체에 릴레이만 |
| `reaction.send` | `{reaction:"like"\|"laugh"\|"shock"\|"clap"\|"gg"}` | 미지원 값 → `INVALID_MESSAGE`. `reaction.broadcast{playerId, reaction}` 본인 포함 릴레이. 레이트 리밋 없음 |
| `chat.send` | `{text}` | [chat.md](chat.md). 빈 줄·200자 초과 → `INVALID_MESSAGE`, 도배 → `RATE_LIMITED`. `chat.message{messageId, playerId, nickname, text, at}`를 본인 포함 전체에 릴레이 |
| `game.<code>.*` | 게임 모듈로 라우팅 | 방 미참가 → `AUTH_REQUIRED`, 방의 게임과 네임스페이스 불일치·미지원 이벤트 → `INVALID_MESSAGE` |

방향 S→C (방 공통). `roomId` 열은 envelope에 roomId가 실리는지.

| type | payload | roomId | msgId |
|---|---|---|---|
| `sys.connected` | `{serverTs, protocolVersion, heartbeatIntervalMs}` | ✗ | ✗ |
| `sys.pong` | `{serverTs}` | ✗ | ✗ |
| `sys.disconnect` | `{reason}` | ✗ | ✗ |
| `sys.reconnected` | `{snapshot}` | ✓ | 요청 에코 |
| `room.joined` | `{you, sessionToken, snapshot}` (본인만) | ✓ | ✗ |
| `room.player_joined` | `{player:{playerId, nickname, status, isHost, kind}}` | ✓ | ✗ |
| `room.player_left` | `{playerId}` | ✓ | ✗ |
| `room.ready_changed` | `{playerId, ready}` | ✓ | ✗ |
| `room.closed` | `{reason}` | ✓ | ✗ — 현재 유일 발신처(GameAbortService)가 데드 코드라 **실전에서 전송된 적 없음** |
| `reaction.broadcast` | `{playerId, reaction}` | ✓ | ✗ |
| `presence.update` | `{playerId, status}` | ✓ | ✗ — 재접속(online)과 PLAYING 중 끊김(offline)에서만 발생. 최초 입장에서는 안 보낸다(player_joined가 status를 나른다) |
| `state.sync` | `{snapshot}` | ✓ | ✗ — 봇 REST 변경 시. 게임 네임스페이스 붙은 `game.<code>.state.sync`는 게임 시작/리셋/종료 시 |
| `error` | `{code, message, refMsgId?}` | **✗** | **✗** — error envelope에는 roomId·msgId를 싣지 않는다. `context` 필드는 항상 null(와이어에 나타난 적 없음) |

`RoomSnapshot`(WS) 모양 — REST 스냅샷과 **다르다**(phase 대소문자 주의):

```json
{ "roomId": "ABC123", "gameCode": "YACHT_DICE", "phase": "waiting|playing|finished",
  "hostId": "...", "capacity": 6,
  "players": [{ "playerId": "...", "nickname": "...", "status": "online|away|offline",
                "isHost": true, "kind": "HUMAN|BOT" }],
  "game": { ...게임별 상태, 없으면 필드 생략(NON_NULL)... } }
```

- 프론트 리듀서 제약: `game.ping_pong.state`·`game.duel.state`는 스냅샷의
  `gameCode`가 일치할 때만 적용된다 — **duel·pingpong 방의 스냅샷에는 gameCode가
  반드시 실려야 한다**. `null`이 필요한 필드는 생략(NON_NULL 직렬화).
- 스냅샷의 players 정렬: 실시간 병합 스냅샷은 playerId 오름차순. 봇은 소켓이
  없으므로 항상 `online`, Redis에는 있지만 소켓이 없는 사람은 `offline`.

## WS 오류 코드

`code`는 Java enum 이름 그대로 SCREAMING_SNAKE로 직렬화된다.

| code | 발생 지점 |
|---|---|
| `AUTH_REQUIRED` | 방 참가 전에 게임 메시지 |
| `SESSION_EXPIRED` | `room.join`의 토큰 만료/불일치 |
| `ROOM_NOT_FOUND` | join 대상 방이 Redis에 없음; 야추 `GAME_NOT_FOUND` 매핑 |
| `NOT_IN_ROOM` | 멤버십 없는 room.*·chat.*·게임 메시지, envelope roomId 불일치 |
| `GAME_ALREADY_STARTED` | PLAYING 방에 좌석 없는 신규 join |
| `NOT_YOUR_TURN` | 비활성 플레이어의 dice.throw/roll·중복 제출 |
| `INVALID_MESSAGE` | 파싱 실패, 필드 누락, 닉네임 불량, 미지원 게임 메시지, 라운드 불일치 등 |
| `INTERNAL` | 재접속 스냅샷 실패, 점수 저장 실패, 라운드 미초기화 |
| `AUTH_FAILED` / `ROOM_FULL` / `ALREADY_IN_ROOM` / `RATE_LIMITED` | **선언만, 전송된 적 없음** (정원은 REST에서 판정) |

프론트의 세션 종료 매핑: `SESSION_EXPIRED`·`AUTH_FAILED`·`AUTH_REQUIRED` →
세션 만료 처리, `GAME_ALREADY_STARTED` → 제거됨, `ROOM_NOT_FOUND` → 방 사라짐.
나머지는 복구 가능으로 취급된다.

## 불변식

- 서버가 만드는 모든 상태 전파는 "증분 이벤트 + 스냅샷"이며, 클라이언트가
  증분만으로 권위 상태를 재구성해야 하는 상황을 만들지 않는다([reconnect.md](reconnect.md)).
  `state.sync`는 항상 전체 스냅샷이지 diff가 아니다. 타이머 틱 이벤트는 없다 —
  마감은 `deadline`(epoch ms) 하나로 전달하고 클라이언트가 카운트다운을 그린다.
- 소켓 끊김은 방 나가기가 아니다. 멤버십(Redis)은 REST 나가기 또는 서버
  정책(유예 만료 close, 오프라인 2턴 자동 퇴장)만 바꾼다.
- 중복·역순 메시지는 클라이언트가 견딘다(프론트 리듀서가 방어) — 서버는 순서를
  보장하려 애쓰되 그것에 의존하는 설계를 하지 않는다.
- 클라이언트 연결 오류(`error` 이벤트)만으로는 프론트가 재연결하지 않는다 —
  깨끗한 close 프레임 없이 반쯤 죽는 서버는 클라이언트를 멈추게 한다. 종료 시
  반드시 close를 보낸다.
