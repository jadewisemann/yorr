# 컨트롤러 링크 — 폰↔큰 화면 WebRTC DataChannel

> SSOT: [`../../src/realtime/controllerLink/`](../../src/realtime/controllerLink/) —
> `controllerLink.ts`(협상·채널) · `relay.ts`(무엇을 실어 나르는지, 봉투 변환) ·
> `ControllerLinkContext.tsx`(수명·시그널링 배선),
> [`../../src/room/model/useControllerLinkRole.ts`](../../src/room/model/useControllerLinkRole.ts)(역할 판정).
> 서버 쪽 계약은 [backend controller-signal.md](../../../backend/docs/design/controller-signal.md),
> 결정의 배경은 [ADR-0002](../adr/0002-controller-link-signaling.md).

파티 모드에서 컨트롤러 폰의 **연출 신호를 서버를 거치지 않고 큰 화면에 직접** 보낸다.
링크가 없으면 지금까지와 똑같이 WebSocket으로 간다.

## 파일 지도

| 파일 | 책임 |
|---|---|
| `realtime/controllerLink/relay.ts` | 링크로 보낼 수 있는 메시지 목록(`RELAYABLE_TYPES`), DataChannel 프레임 파싱, 클라이언트 메시지 → **서버가 뿌렸을 봉투** 변환 |
| `realtime/controllerLink/controllerLink.ts` | `ControllerLink` — RTCPeerConnection + DataChannel 두 개, 협상 규칙, RTT 측정. React·store를 모른다 |
| `realtime/controllerLink/ControllerLinkContext.tsx` | 수명·시그널링 배선. `useControllerLink()`는 provider 밖에서 `NO_LINK`로 강등한다 |
| `room/model/useControllerLinkRole.ts` | 이 기기의 역할(`dashboard`·`controller`·없음) 판정 |
| `realtime/realtimeClient.ts` | `deliverLocal()` — 피어에게 직접 받은 봉투를 서버 메시지와 같은 팬아웃에 흘리는 유일한 주입 구멍 |

## 지연은 어디서 줄어드는가

파티 모드의 신호 경로는 원래 두 홉이었다.

```text
[폰] ──WS/TCP──▶ [서버] ──WS/TCP──▶ [큰 화면]      (기존)
[폰] ──DataChannel/UDP──────────────▶ [큰 화면]     (링크가 붙었을 때)
```

줄어드는 것은 세 가지다: **서버까지 갔다 오는 홉 하나**, 그 홉에서의 서버 처리·직렬화,
그리고 **TCP head-of-line blocking**(흔들림 펄스는 60ms마다 나가므로 앞 패킷이 재전송을
기다리는 동안 뒤 펄스가 함께 밀린다). 파티 모드의 폰과 TV는 보통 같은 공유기 아래 있어
ICE가 host 후보로 붙고, 그때 경로는 서버 왕복과 비교가 되지 않는다.

> ⚠️ **실기기 측정은 아직 없다.** 위는 구조적 근거이고 실제 절감 폭은 미검증이다.
> 재기 위해 링크에 RTT 프로브를 넣어 뒀다 — `useControllerLink().rttMs()`가 컨트롤러 쪽에서
> 측정한 왕복 시간이다(2초 주기, keepalive 겸용). 화면에는 노출하지 않았다.

## 무엇이 링크로 가고, 무엇이 못 가는가

**판정 기준 하나**: 서버가 그 메시지를 **판정·저장하는가**. 서버는 WebSocket만 말하므로,
권위 메시지는 링크로 보낼 수 없다 — 보내면 판정이 사라진다(설계 원칙 1: 서버 권위).

| 메시지 | 링크 | 왜 |
|---|:--:|---|
| `game.yacht_dice.dice.shake` | ✅ | 서버가 그대로 중계만 한다. 60ms 주기 스트림이라 절감 폭이 가장 크다 |
| `game.yacht_dice.dice.throw` | ✅ | 같은 릴레이. 던진 시점이 곧 사발이 쏟아지는 시점이다 |
| `game.yacht_dice.dice.roll` | ❌ | 주사위 값을 서버가 굴린다 |
| `game.yacht_dice.dice.hold` | ❌ | 서버가 라운드 상태에 저장한다(재접속 스냅샷의 `held`) |
| `game.yacht_dice.round.submit` | ❌ | 점수 확정 |
| `game.ping_pong.swing` | ❌ | 서버가 `clientTs`로 최대 120ms 되감아 판정한다([pingpong.md](pingpong.md)) — 업링크 지연은 이미 그쪽에서 보상된다 |
| `game.ping_pong.ready` | ❌ | 준비 게이트 |
| `game.duel.draw` | ❌ | 판정도 서버지만, **연출용으로 곁들여 보내도 안 된다** — 무대 불변식 「상대 총알·기록은 판정 후에만」([duel.md](duel.md))을 깨서 유예 중에 상대가 뽑는 게 보이면 승부가 김이 샌다. 밸런스 페널티도 "전송을 늦춰서" 걸기 때문에 빠른 경로가 오히려 해롭다 |

즉 **탁구·석양이 진다는 링크를 쓰지 않는다.** 두 게임의 컨트롤러 지연은 전송을 바꿔서
줄이는 문제가 아니라 판정 시각 보정으로 이미 다루고 있다. 링크의 값은 야추의 관전 연출에
있다.

## 토폴로지 — 역할이 비대칭이다

```text
        ┌── DataChannel ──▶ 컨트롤러 폰 A
[대시보드]├── DataChannel ──▶ 컨트롤러 폰 B
        └── DataChannel ──▶ 컨트롤러 폰 C
```

**대시보드가 offer를 만든다.** 서버가 대시보드를 플레이어 명단에 넣지 않으므로
(room-and-session.md 「파티 모드」) **폰은 대시보드의 playerId를 알 방법이 없고**, 반대로
대시보드는 스냅샷 `players`에서 폰들의 id를 본다. 그래서 "id가 작은 쪽이 offer한다" 같은
대칭 규칙을 쓸 수 없다. 역할이 비대칭인 덕에 양쪽이 동시에 offer하는 glare가 아예 생기지
않아 perfect negotiation의 롤백도 필요 없다.

폰은 `ctrl.signaled.from`으로 상대를 처음 알게 된다. 그래서 컨트롤러 쪽 `syncPeers`는
아무 일도 하지 않고, 협상은 언제나 대시보드가 먼저 건다.

## 시그널링 — `ctrl.signal` 유니캐스트

`ctrl.signal`(C→S, `{to, data}`)과 `ctrl.signaled`(S→C, `{from, data}`) 두 메시지를 쓴다.
서버는 `data`를 **파싱하지 않고** 같은 방의 지목된 상대에게만 전달하고, `from`을 레지스트리에서
채운다. 서버가 하는 일은 그것이 전부다
([backend controller-signal.md](../../../backend/docs/design/controller-signal.md)).

- **`chat.*`을 재사용하지 않는다** — 방 전체 브로드캐스트이고 글자 수 상한과 도배 한도가
  걸려 있다. 협상은 두 피어 사이의 일이라 남이 받으면 의미가 없고, ICE 후보의 빈도는 채팅
  한도를 그대로 넘긴다.
- 처음 계획은 삭제된 `voice.signal`에 갈래를 얹는 것이었다(백엔드 변경 0). 음성이 텍스트
  채팅으로 교체되며 그 경로가 사라져 새 타입이 유일한 길이 됐다 — 반전의 기록은
  [ADR-0002](../adr/0002-controller-link-signaling.md).
- 넓히기만 했으므로 `ctrl.*`를 모르는 서버·클라이언트와 섞이면 협상이 조용히 실패하고,
  링크가 안 열려 컨트롤러 입력은 그대로 WebSocket으로 간다.

## 채널을 두 개 쓴다

| 채널 | 설정 | 싣는 것 |
|---|---|---|
| `yorr.ctrl.pulse` | `ordered: false`, `maxRetransmits: 0` | 흔들림 펄스 |
| `yorr.ctrl.event` | `ordered: false` | 던지기, RTT 프로브 |

기준은 **"유실돼도 다음 것이 덮는 신호는 unreliable, 한 번뿐인 신호는 reliable"** 이다.
흔들림 펄스는 60ms마다 새로 오므로 재전송으로 늦게 도착한 옛 펄스가 오히려 화면과
어긋나고, 던지기를 놓치면 대시보드의 사발이 제때 쏟아지지 않는다. 순서는 둘 다 강제하지
않는다 — 순서를 지키게 하면 TCP와 같은 이유로 앞 패킷이 뒤를 붙잡는다.

채널은 **offer를 만들기 전에** 열어야 SDP에 실린다(`addPeer`의 순서가 계약이다).

## 수신 — 소비자는 전송을 모른다

받은 릴레이 프레임은 `relayedServerMessage()`가 **서버가 뿌렸을 봉투와 같은 모양**으로
바꾸고(`shake` → `shaken`, `playerId` 채움), `client.deliverLocal()`로 서버 메시지와 같은
팬아웃에 흘린다. 그래서 `useRollIncoming`을 비롯한 소비자는 한 줄도 바뀌지 않았고, 링크가
붙었는지 여부로 화면 코드가 갈리지 않는다.

`playerId`는 **서버가 찍어 준 `ctrl.signaled.from`** 을 쓴다. 프레임 안의 주장을 믿으면
남을 사칭할 수 있다 — `reaction.broadcast`·`chat.message`의 `playerId`와 같은 규칙이다.
다른 방 `roomId`가 실린 프레임은 버린다.

## 컨텍스트 값은 status가 바뀔 때만 새로 만든다

`useControllerLink()`가 돌려주는 객체의 신원은 **`status`가 바뀔 때만** 바뀐다. `trySend`와
`rttMs`는 내부 ref를 읽는 안정한 함수라 링크가 새로 만들어져도 그대로다.

RTT를 값으로 담았더니 2초마다(측정 주기) 컨텍스트 값이 바뀌었고, 그러면 게임 중
`useRollBroadcast`의 콜백이 새로 만들어져 그 콜백에 매달린 effect(`useRollIncoming`의 메시지
구독 등)가 함께 재실행된다. **화면에 그리지 않는 관측값이 게임 중 리렌더를 만들 이유가
없다** — 그래서 `rttMs`는 값이 아니라 함수다.

## 폴백 규칙

`ControllerLink.send()`는 **보냈으면 true, 못 보냈으면 false**를 돌려주고, 호출부
(`useRollBroadcast`)가 false일 때 그 자리에서 WebSocket으로 보낸다. 폴백을 링크 안에
감추지 않은 이유는, 감추면 "무엇이 서버를 거쳤는가"가 호출부에서 안 보이기 때문이다.

**두 경로로 동시에 보내지 않는다.** 파티 모드에서 이 두 이벤트를 소비하는 화면은
대시보드뿐이므로(컨트롤러 폰은 `GameControllerPad`를 그리고 3D 사발이 없다) 링크가 닿았으면
서버 릴레이는 같은 그림을 한 번 더 그리는 일이 된다.

폴백이 실제로 도는 경우들:

- **파티 방이 아니다** → 링크를 아예 만들지 않는다(`useControllerLinkRole`이 `null`).
- **ICE가 못 붙는다** → **STUN만 쓰고 TURN을 붙이지 않는다**(아래 절). 폰과 TV가 서로 다른
  네트워크에 있으면 링크가 안 붙고 조용히 WS로 남는다.
- **서버·상대가 낡았다** → `ctrl.signal`을 모르는 서버는 `INVALID_MESSAGE`로 답하거나
  무시하고, `ctrl.*`를 모르는 상대는 조용히 버린다. 어느 쪽이든 링크가 안 열릴 뿐이다.
- **연결이 죽었다** → `connectionState === 'failed'`면 피어를 버린다. **재협상은 대시보드만**
  한다(2초 뒤) — offer를 만들 수 있는 쪽이 하나뿐이다. 폰은 버리고 기다리며, 그 사이 입력은
  WS로 간다.

## TURN을 붙이지 않는다 (STUN만)

ICE 설정은 `CONTROLLER_ICE_SERVERS` 상수 하나다(`controllerLink.ts`).

**TURN을 쓰면 이 링크의 존재 이유가 사라진다.** 중계 경로는 `폰 → TURN → TV`인데, 폴백인
`폰 → 앱서버 → TV`와 홉 수가 같다. 같은 호스트에 띄우면 완전히 동일하다. 즉 중계 대역폭과
coturn 운영과 3478·5349 포트 개방을 지불하고 얻는 것이 없다. 삭제된 음성과 갈리는 지점이
여기다 — 음성에는 폴백이 없어서 TURN이 없으면 기능 자체가 실패했다.

**STUN은 유지한다.** 트래픽이 지나가지 않아 서버 비용이 없고, 손님 폰이 집주인 와이파이에
붙지 않은 경우(LTE)를 덮는다. 같은 랜에서는 STUN이 없어도 host 후보만으로 붙지만, 있어도
느려지지 않는다 — host 후보 쌍이 우선순위가 높아 먼저 검사되고, srflx 수집은 그와 병렬로
돈다.

**발급 REST(`GET /voice/ice`)를 되살리지 않는다.** 음성과 함께 삭제됐고, 되살릴 이유가 둘
다 없다: STUN은 자격이 필요 없고, 인증 없는 TURN 자격 발급은 중계 대역폭의 무단 사용
표면이었다. 상수라 링크를 **동기적으로** 만들 수 있는 것이 곁따라 온 이득이다 — 발급을
기다리던 예전 배선은 응답이 오지 않는 망에서 링크가 영영 만들어지지 않았다.

같은 랜인데도 안 붙는 경우가 하나 있다. 브라우저는 host 후보의 사설 IP를 `*.local`
mDNS 이름으로 감추고(RFC 8828), 상대가 그것을 멀티캐스트 DNS로 풀어야 한다. 멀티캐스트를
막거나 단말 격리(AP isolation)가 켜진 망에서는 실패하는데, 그때는 TURN을 붙여도 마찬가지다
— 단말끼리의 직접 통신 자체가 막혀 있다.

## 알려진 틈

- **초대 코드를 손으로 입력해 들어온 폰**은 자기가 파티 컨트롤러인 줄 모르고(기존 구멍,
  room-and-session.md) 일반 화면으로 떠서 3D 사발을 그린다. 굴리는 사람이 링크를 쓰면
  서버 릴레이가 나가지 않으므로 **그 폰만 흔들림 연출을 못 본다.** 근본 원인은 서버
  스냅샷에 방 모드가 없는 것이고, 그 구멍이 메워지면 함께 사라진다.
- **링크 상태를 사용자에게 알리지 않는다.** 붙었는지 여부로 화면이 달라지지 않으므로
  알릴 것이 없다고 판단했다. 대시보드 참가자 목록에 "직결" 표시를 붙이는 것은 열린 선택지다.
- **RTT는 화면에 없다.** 관측은 `useControllerLink().rttMs()`로만 가능하다.
