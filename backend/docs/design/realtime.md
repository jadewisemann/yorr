# 실시간 통신 (WebSocket)

> 상위 원칙은 [DESIGN.md](../../DESIGN.md). 와이어 계약의 정본은
> `frontend/src/realtime/wsEvents.ts`(프로토콜 버전 1)이며, 이 문서는 서버 관점의
> 모델만 설명한다.

## Envelope

모든 메시지는 한 가지 봉투를 쓴다.

```ts
{ type: string, ts: number, payload: unknown, roomId?: string, msgId?: string }
```

- 서버는 봉투 모양만 게이트웨이에서 검증한다(`ws/envelope.ts`). payload 해석은
  각 핸들러·게임 모듈의 책임이다.
- 파싱 불가 메시지는 버린다. (Java 쪽 관용 범위는 Phase 1 이식 때 확정 —
  IMPLEMENTATION_NOTES 참고)

## 연결 수명

```text
connect → 서버가 sys.connected {serverTs, protocolVersion, heartbeatIntervalMs}
        → 클라이언트가 heartbeatIntervalMs 간격으로 sys.ping {clientTs}
        → 서버가 sys.pong {serverTs}
```

- 브라우저 WebSocket은 커스텀 헤더를 못 붙이므로 **인증은 연결 직후 첫
  `room.subscribe` 메시지의 payload(userId, sessionToken)** 로 한다.
- 서버는 토큰 검증 후 해당 소켓만 방 구독 목록에 넣고 최신 `room.snapshot`을
  내려준다.

## 구독·브로드캐스트

- 소켓 ↔ 방 매핑은 프로세스 인메모리(`ws/registry.ts`)다. **여기에 게임 상태를
  두지 않는다** — 상태의 권위는 Redis다.
- REST로 방 상태가 바뀌면(참가·나가기·시작) WS 계층이 같은 `room.snapshot`
  형식으로 방 전체에 broadcast한다. 클라이언트는 스냅샷으로 로컬 상태를 전체
  교체한다.
- 게임 진행 메시지(`round.submit` 등)는 게임 모듈로 라우팅된다
  ([game-modules.md](game-modules.md)).

## 불변식

- 서버가 만드는 모든 상태 전파는 "증분 이벤트 + 필요 시 스냅샷"이며, 클라이언트가
  증분만으로 권위 상태를 재구성해야 하는 상황을 만들지 않는다
  ([reconnect.md](reconnect.md)).
- 연결이 끊긴 소켓은 registry에서 제거된다. 방 멤버십(Redis)은 소켓 끊김으로
  변하지 않는다 — 나가기는 REST가 처리한다.
