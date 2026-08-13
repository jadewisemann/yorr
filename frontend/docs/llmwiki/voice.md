# 음성 채팅 — WebRTC 풀메시

> SSOT: [`../../src/realtime/voice/voiceMesh.ts`](../../src/realtime/voice/voiceMesh.ts)와
> `wsEvents.ts`의 `voice.*` 계약(VOICE-001 블록). 티켓 S15P11A406-130.

## 구조 결정

- **풀메시, SFU 없음.** 오디오는 피어끼리 직접 흐르고 서버는 시그널링(`voice.*`)만 같은
  WebSocket으로 중계한다. 방 정원이 6명이라 피어당 연결 4~5개, 업링크 Opus 30kbps × 5 ≈
  150kbps로 감당되는 구간이다.
- **서버는 SDP·ICE를 파싱하지 않는다.** 봉투만 보고 배달한다 — 파싱하는 순간 브라우저가
  규격을 늘릴 때마다 서버를 같이 고쳐야 한다.
- **음소거는 비공개다.** `voice.mute` 이벤트도 `muted` 플래그도 없다 — 상대에게 보이지 않는다.
- **"말하는 중" 표시는 클라 파생이다.** 각 클라가 수신기의
  `getSynchronizationSources().audioLevel`을 직접 읽는다(100ms 폴링, 임계 0.02). 서버로
  올리면 말할 때마다 메시지가 나가고 표시도 늦다.
- `voice.peers`는 증분이 아니라 **전체 명단**이다. 메시지 하나를 놓쳤을 때 명단이 영구히
  어긋나는 위험을 없앤다. `voice.signaled`의 `from`은 서버가 찍는다 — 클라가 주장하는 신분을
  믿으면 사칭이 가능하다.
- 라이브러리(simple-peer 등)를 쓰지 않는다 — "누가 offer를 만드는가"와 "후보 큐"를 감추기
  때문이다. 아래 세 규칙이 이 파일의 존재 이유다.

## VoiceMesh 세 규칙

1. **offer는 playerId가 (문자열 비교로) 작은 쪽만 만든다.** 양쪽이 동시에 offer를 만드는
   glare를 규칙으로 제거해 perfect negotiation의 롤백이 필요 없다. 서버는 관여하지 않는다.
2. **remote description 전에 온 ICE 후보는 큐에 쌓았다가 flush한다.** 큐가 없으면 통화가
   간헐적으로, 재현이 어려운 쪽으로 안 붙는다.
3. **connectionState가 failed면 스스로 재협상한다** (drop 후 2초 뒤 re-add). 폰은 화면
   잠금·WiFi↔LTE 전환에서 실제로 여기 걸린다. ICE restart를 쓰지 않는 이유: 재시작은 offer를
   만드는 쪽만 할 수 있는데 실패를 먼저 알아채는 쪽은 그 반대일 수 있다 — consent
   freshness(RFC 7675)로 30초 안에 같이 failed가 되고, 그때 작은 쪽이 offer한다. 재시도
   횟수 제한은 의도적으로 없다.

## 데이터 흐름

```text
mic 토글 → getUserMedia(AGC·EC·NS) → GET /voice/ice (STUN 폴백) → VoiceMesh 생성
        → voice.join 전송 → status 'on'
서버 → voice.peers{전체 명단} → mesh.syncPeers: 빠진 피어 drop / 새 피어 addPeer
        → (내 id가 작으면) createOffer → voice.signal{to, data} → 서버 중계 → voice.signaled{from, data}
        → accept: description이면 setRemote(+answer), candidate면 큐 or addIceCandidate
'track' → 숨긴 <audio> 엘리먼트에 srcObject 연결
```

## 수명·배치 결정

- `VoiceProvider`는 **라우터 위**에 있다(`RealtimeSync` 안). 화면마다 훅을 부르면 라우트
  전환 때 연결이 전부 닫히고 새 화면에서 처음부터 재협상한다(1~2초 무음).
- 대신 방을 나가도 훅이 언마운트되지 않으므로, provider가 `roomSession.you`를 감시해
  마이크를 강제로 끈다 — 켜진 채로 남으면 사용자가 모른다.
- `useVoice()`는 provider 밖에서 던지지 않고 `NO_VOICE`로 강등한다.
  (`useRealtimeClient`는 던진다 — 그건 없으면 앱이 아예 안 돌아가고, 음성은 없어도 게임이
  돌아가므로 심각도가 다르다.)
- 상대별 음소거는 mesh에 보관한다. RTCPeerConnection에 두면 상대가 끊겼다 돌아올 때 새
  연결이 만들어지며 껐던 뜻이 사라진다. 구현은 `audio.muted`만 — 트랙을 끊으면 재협상이
  필요하고 상대에게 연결 끊김처럼 보인다.

## 모바일(iOS) 주의점

- **`<audio>`는 DOM에 붙인다.** 떼어놓은 엘리먼트로도 크롬에서는 소리가 나지만 iOS Safari는
  미디어 엘리먼트가 문서에 없으면 재생을 거부하는 경우가 있다.
- **iOS의 `HTMLMediaElement.volume`은 사실상 읽기 전용이다** — 대입해도 조용히 무시된다.
  게다가 값은 저장해서 읽으면 넣은 값이 그대로 나오므로 **기능 탐지로도 속는다**(실기기
  확인). 그래서 효과음·BGM은 `shared/audio/elementVolume.ts`가
  `createMediaElementSource → GainNode` 경유로 볼륨을 구현하고, AudioContext는 모든
  `pointerdown/touchend/keydown`에서 `resume()`한다(한 번만 깨우면 다시 잠긴 뒤 영영
  무음). 음성 피어 볼륨은 이 경로를 쓰지 않고 iOS에서도 동작하는 `muted` 이진 토글만 쓴다.
- 비보안 컨텍스트(http://LAN IP)에서는 `navigator.mediaDevices` 자체가 없다 →
  `unsupported`로 강등하고 마이크 UI를 숨긴다.

## 배포 주의점 (`iceServers.ts`)

- 반드시 `API_BASE_URL` 절대 경로로 호출한다 — 상대경로 `/api/v1/...`은 Vercel rewrite에
  삼켜져 `index.html`이 200으로 돌아오고, TURN이 영원히 안 붙는다.
- `credentials`를 보내지 않는다 — 백엔드가 `allowCredentials(false)` + `ACAO: *`다.
- 응답을 캐시하지 않는다 — TURN 자격증명에 수명이 있다.
