# 재접속

> 상위 원칙은 [DESIGN.md](../../DESIGN.md). Java 원본:
> `game/round/application/GameReconnectSnapshotService`,
> `handler/GameWebSocketHandler`(재접속 분기), `ws/RoomSessionRegistry`.

## 불변식

**재접속한 클라이언트는 증분 이벤트로 권위 상태를 재구성하지 않는다.**
서버가 내려주는 스냅샷이 새로운 동기화 기준점이며, 스냅샷 이전의 이벤트는
재구성된 상태에 영향을 주면 안 된다.

## 흐름 (실제 프로토콜 — `sys.reconnect` 메시지는 없다)

```text
client (저장해 둔 sessionToken 보유)
   ↓  WS 재연결
server → sys.connected (하트비트 재시작의 필수 신호)
client → room.join {roomId, sessionToken}     ← 최초 join과 같은 메시지
server
   ↓  토큰 검증 → 기존 좌석 발견(= 재접속 판정)
   ↓  좌석·host 플래그 유지한 채 소켓 교체
   ↓  이전 소켓에 sys.disconnect{replaced_by_new_session} → close 1008
   ↓  sys.reconnected { snapshot }   (roomId·msgId 에코)
   ↓  방 전체에 presence.update {playerId, status:"online"}
```

- 프론트는 REST 재참가를 하지 않는다 — 소켓 재연결(1초 고정 간격, 최대 10회)
  후 `room.join` 재전송이 전부다. 11회째 실패 시 세션을 보존한 채
  "disconnected"로 파킹한다.
- 좌석이 이미 없으면(유예 만료로 방이 닫혔거나 자동 퇴장) 일반 join 규칙이
  적용된다: LOBBY면 신규 입장, PLAYING이면 `GAME_ALREADY_STARTED`.
- 재접속 분기에서는 `room.joined`·`room.player_joined`가 나가지 않는다.

## 스냅샷 내용 (phase에 따라)

- phase가 PLAYING이 아니면: 실시간 병합 방 스냅샷 그대로(`game` 필드 생략).
- PLAYING이면 `snapshot.game`에 게임 상태 동봉:
  - **야추**: `{roundNumber, activePlayerId, roundDeadline, scores(전원
    ScoreBoard), turnOrder, rollCount, dice?, held?}` — 진행 중 턴의
    rollCount·dice·held가 **반드시** 실린다. 없으면 복귀자가 굴림 수를 0부터
    세서 다음 roll이 거부된다. 첫 굴림 전이면 rollCount 0에 dice·held 생략.
    라운드 상태나 활성 마감이 없으면 스냅샷 생성이 실패한다(→ `INTERNAL` +
    fanout 등록 해제).
  - **duel / pingpong**: 각자의 상태 객체(DuelState / PingPongState) 전체.
- 야추 reconnect는 오프라인 미스 카운터도 리셋한다 — 짧은 끊김이 자동 퇴장
  (2턴)으로 적립되지 않게.

## 소켓 끊김과 멤버십 (재접속의 전제)

- 끊김(1006 포함)은 방 나가기가 아니다. PLAYING 중 끊김은 좌석을 유지한 채
  OFFLINE 마킹 + `presence.update{offline}`만 한다. 오프라인 활성 플레이어의
  턴은 무득점 스킵되고, 2턴 연속이면 자동 퇴장된다([game-modules.md](game-modules.md)).
- 방의 마지막 소켓이 사라지면 타이머를 멈추고 유예(게임 중 10분/로비 30초) 후
  방을 닫는다. 유예 안에 누군가 join하면 취소되고 타이머가 재개된다.
- 같은 세션 토큰의 새 소켓이 이기고 옛 소켓이 진다(교체). 오프라인 좌석의
  복귀도 같은 경로다.

## 규칙

- 스냅샷은 그 시점의 화면을 그리기에 **충분**해야 한다 — 클라이언트가 부족분을
  추가 이벤트로 메꾸게 하지 않는다. 진행 중 턴 정보(rollCount 등)가 충분성의
  기준 사례다.
- 게임별 재접속 응답은 GameModule.reconnect가 만든다 — 프레임워크는 방 스냅샷,
  모듈은 게임 상태를 책임진다.
- 프론트 리듀서의 스냅샷 병합 규칙(서버가 지켜야 할 전제): 스냅샷에 `game`이
  있으면 서버를 신뢰하고, 없으면 로컬 game을 보존한다("game 없는 스냅샷이
  쌓인 score.update를 지우는" 사고 방지). FINISHED로 간 phase는 낡은 응답이
  되돌릴 수 없다.

## 알려진 틈 (Java 그대로 — 바꾸려면 결정 기록)

- 재접속 분기는 방 폐쇄 예약을 **취소하지 않는다**(최초 join 분기만 취소).
  좌석이 남아 있으면 발화 시점의 빈 방 재확인이 no-op이 되어 실전에서는
  가려진다.
- 재접속 분기는 `resume()`을 부르지 않는다 — pause로 타이머가 멈춘 방에
  재접속하면 활성 마감이 없어 야추 스냅샷 생성이 `INTERNAL`로 실패할 수 있다
  (최초 join 분기의 resume가 실행되는 "유예 취소" 경로에서만 재개된다).
  Java와 동일하게 두되, 이식 중 실측으로 재현 조건을 확인하고 고칠지 결정한다.
