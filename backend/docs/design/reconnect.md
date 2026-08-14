# 재접속

> 상위 원칙은 [DESIGN.md](../../DESIGN.md). Java 원본:
> `game/round/application/GameReconnectSnapshotService` 등.

## 불변식

**재접속한 클라이언트는 증분 이벤트로 권위 상태를 재구성하지 않는다.**

```text
client
   ↓  REST 재참가 (저장한 게스트 토큰) → 최신 snapshot
   ↓  WS room.subscribe {userId, sessionToken}
server
   ↓  검증 → 구독 등록
   ↓  room.snapshot (게임 중이면 게임 상태 포함)
```

스냅샷이 새로운 동기화 기준점이 된다. 스냅샷 이전의 이벤트는 재구성된 상태에
영향을 주면 안 된다.

## 규칙

- 스냅샷은 그 시점의 화면을 그리기에 **충분**해야 한다 — 클라이언트가 부족분을
  추가 이벤트로 메꾸게 하지 않는다.
- 같은 게스트의 재참가는 멤버십을 중복 증가시키지 않는다
  ([rooms-and-sessions.md](rooms-and-sessions.md)).
- 소켓 끊김(1006 포함)은 방 나가기가 아니다. 멤버십 변경은 REST 나가기 또는
  서버 정책(타임아웃 등)만 한다.
- 게임별 재접속 응답은 GameModule.reconnect가 만든다 — 프레임워크는 방 스냅샷,
  모듈은 게임 상태를 책임진다.
