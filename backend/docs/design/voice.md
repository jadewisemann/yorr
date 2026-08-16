# 음성 채팅 (WebRTC 시그널링)

> 상위 원칙은 [DESIGN.md](../../DESIGN.md). Java 원본:
> `handler/GameWebSocketHandler`(voice.* 핸들러), `ws/RoomSessionRegistry`
> (음성 명단), `ws/voice/`(ICE REST).
>
> 구현(Node): `ws/voice.ts`(릴레이·명단 브로드캐스트) · `ws/registry.ts`
> (`joinVoice`/`leaveVoice`/`voiceMembersOf`) · `ws/handler.ts`(메시지 라우팅과
> 정리 순서) · `ws/iceServers.ts` + `http/routes/voice.ts`(ICE 발급).

## 서버의 역할 — 딱 두 가지

P2P 풀 메시(SFU 없음). 서버는 ① 방별 음성 참가 명단을 관리하고 ② 시그널을
지명된 상대에게 릴레이한다. **SDP/ICE 내용을 파싱하지 않는다**(`data`는 불투명
JSON) — 브라우저 스펙이 바뀌어도 서버가 안 바뀌게.

## WS 메시지

모두 `room.join` 이후에만 유효(아니면 `NOT_IN_ROOM`).

| 방향 | type | payload | 동작 |
|---|---|---|---|
| C→S | `voice.join` | (무시) | 명단 추가(멱등) → 방 **전체**에 `voice.peers` |
| C→S | `voice.leave` | (무시) | 명단 제거 → `voice.peers`. 방 나가기가 아니다 |
| C→S | `voice.signal` | `{to, data}` | 검증 후 상대에게만 릴레이 |
| S→C | `voice.peers` | `{peers:[playerId]}` | **전체 명단 스냅샷**(델타 아님). 통화 미참가자 포함 방 전원에게 — 참가 전에도 누가 통화 중인지 UI에 그리기 위해 |
| S→C | `voice.signaled` | `{from, data}` | **유니캐스트**, envelope roomId 포함. `from`은 서버가 레지스트리에서 채운다(클라이언트 주장 무시 — 스푸핑 방지) |

`voice.signal` 규칙:

- `to` 공백 / `data` null → `INVALID_MESSAGE`. **검사 순서가 계약이다**: payload
  검증이 멤버십 검사보다 먼저라, 방 밖에서 깨진 payload를 보내면 `NOT_IN_ROOM`이
  아니라 `INVALID_MESSAGE`가 나간다(Java 그대로).
- 대상 조회는 **방 스코프**(다른 방으로 시그널 불가).
- 대상이 없거나 소켓이 닫혀 있으면 **조용히 버린다**(오류 없음 — 협상 중 이탈은
  정상 경로다).
- 명단 검증은 하지 않는다: 방 멤버면 누구에게든 릴레이된다(Java 동작 그대로).
- `data` 모양(프론트 계약): `{kind:"description", description}` 또는
  `{kind:"candidate", candidate}`. 서버는 모양을 강제하지 않는다.
- **레이트 리밋을 붙인다면 voice.signal은 예외로** — ICE 후보가 폭발적으로
  오가므로 일반 메시지 한도를 적용하면 통화 연결이 안 된다(프론트 문서 명시).

암묵적 이탈: 소켓 종료·`room.leave` 처리 시 **레지스트리에서 세션을 지우기
전에** 음성 명단을 정리하고 `voice.peers`를 재브로드캐스트한다(순서가 계약 —
지운 뒤에는 방을 못 찾는다). `voice.leave` 없이 탭을 닫는 것이 정상 경로다.

오퍼 방향(서버는 관여 안 함, 참고): playerId 사전순 작은 쪽이 오퍼를 만든다.
`voice.mute` 이벤트·muted 플래그는 의도적으로 없다 — 발화 표시는 클라이언트
파생.

## ICE/TURN 자격 증명 (REST — 방에 브로드캐스트하지 않기 위해 별도 경로)

`GET /api/v1/voice/ice` — `X-User-Id` 헤더 선택(없으면 "guest").

```json
{ "iceServers": [ { "urls": ["stun:..."], "username": "...", "credential": "..." } ],
  "ttlSeconds": 600 }
```

- STUN은 항상 포함(기본 `stun:stun.l.google.com:19302`).
- TURN은 `yorr.voice.turn.secret`·`turn.host` **둘 다** 설정된 경우에만: udp
  3478 / tcp 3478 / turns tcp 5349 3개 URL, coturn REST 방식 자격 —
  `username = (epoch초+ttl) + ":" + 식별자`,
  `credential = base64(HMAC-SHA1(secret, username))`, TTL 기본 600초.
- 단명 자격이므로 응답을 캐시하면 안 된다. **서버는 캐시 헤더를 붙이지 않는다** —
  Java도 붙이지 않았고(계약 동결), 캐시 금지는 프론트가 호출할 때마다 새로
  받는 것으로 지킨다(`realtime/voice/iceServers.ts`).
- STUN 항목에는 `username`·`credential`이 **없다**(Node는 undefined 필드를
  생략한다). Java는 Jackson 기본값 때문에 `null`을 실어 보냈다 — 프론트는 그
  객체를 `RTCConfiguration`에 그대로 넘기고 STUN은 두 필드를 보지 않으므로
  동작 차이가 없다. 나머지 필드 이름·순서는 그대로다.

환경변수 이름은 Java의 프로퍼티를 Spring relaxed binding이 읽는 이름
(`.`·`-` → `_`, 대문자)을 그대로 쓴다 — 운영 `.env`를 그대로 재사용하기 위해서다:
`YORR_VOICE_TURN_SECRET` · `YORR_VOICE_TURN_HOST` · `YORR_VOICE_STUN_URL` ·
`YORR_VOICE_TURN_TTL_SECONDS`.

## 운영 결정 — TURN을 제공하지 않는다 (2026-08-14)

**신규 운영 환경에 coturn을 두지 않기로 했다.** `YORR_VOICE_TURN_SECRET`·
`YORR_VOICE_TURN_HOST`를 비워 두면 이 코드가 STUN 후보만 내려주므로 **코드
변경은 없다**.

근거:

- TURN은 "음성에 필요한 것"이 아니라 **P2P 홀 펀칭이 실패하는 소수 경로의
  우회로**다. STUN으로 붙은 통화는 오디오가 서버를 지나지 않는다.
- coturn 운영 비용이 실질적이다: UDP 릴레이 포트 범위 개방, TCP/443 폴백용 TLS
  인증서, 시크릿 관리. **TURN이 없으면 서버가 열어야 하는 포트가 HTTP/WS뿐이라
  호스팅 선택이 자유로워진다**(릴레이 트래픽이 없으므로 egress 과금도 사실상 0).

대가와 그 성질:

- **대칭형 NAT(모바일 CGNAT 다수)·UDP 차단 방화벽 뒤의 사용자는 통화가 붙지 않는다.**
- 음성이 **풀 메시**라 방 단위가 아니라 **쌍 단위로** 갈린다 — 문제가 있는 한 명이
  나머지 전원과 안 붙고 그들끼리는 정상이다. 사용자에게는 "나만 안 들려요"로
  보인다.
- **이 실패는 서버에 흔적을 남기지 않는다.** 시그널 릴레이는 성공하고 P2P 협상만
  브라우저 안에서 실패하기 때문이다. 그래서 프론트에 ICE 실패 계측(선택된 후보가
  relay/srflx인지, `iceConnectionState`가 `failed`로 끝난 쌍의 수)을 붙여야
  실패율을 알 수 있다 — **프론트 작업이며 이 마이그레이션 범위 밖이다.**

되돌리는 방법: 환경변수 네 개를 채우면 끝이다(재배포만 필요, 코드 변경 없음).
매니지드 TURN(GB당 과금)으로 갈 경우에는 자격 발급 방식이 달라 `ws/iceServers.ts`의
자격 경로만 교체하면 된다 — `GET /voice/ice`의 응답 모양은 그대로 쓸 수 있다.

## 이식된 테스트

- `ws/__tests__/voice.test.ts` — Java `RoomSessionRegistryVoiceTest`(명단 격리·
  멱등·방 소멸 시 폐기) + `GameWebSocketHandlerTest`의 voice 케이스(전원 방송,
  from 스푸핑 차단, 부재 상대 무음 드롭, 소켓 종료 시 정리, 방 밖 `NOT_IN_ROOM`).
  방 스코프 격리·`room.leave` 정리·게임 중 끊김은 Java에 없던 추가 케이스다.
- `ws/__tests__/gateway.test.ts` — 진짜 소켓 위에서 join→peers→signal→탭 닫기.
- `http/routes/__tests__/voice.test.ts` — ICE 발급(STUN 폴백, 반쪽 설정 무시,
  HMAC 자격, guest 식별자).
