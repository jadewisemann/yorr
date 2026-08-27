# PLANS — 진행 중 변경

> "시스템이 어떻게 동작하는가"는 [DESIGN.md](DESIGN.md), 계획이 끝나면 이
> 문서에서 지우고 결과를 설계 문서에 반영한다.

## 현재 상태: 와이어 계약 동결 🧊

백엔드 Java → JS 마이그레이션([backend/PLANS.md](../backend/PLANS.md))이 끝날
때까지 프론트엔드 프로덕션 코드는 변경하지 않는 것이 목표다. 특히
`src/realtime/wsEvents.ts`와 REST 사용부는 **계약 동결** 상태다

> **동결을 깬 3건.** 「연습 방 시계」(넓히기)·「음성 채팅 → 텍스트 채팅」(교체)·
> 「컨트롤러 링크」(넓히기) 절에 각각 근거가 있다. 셋 다 마이그레이션이 아니라 제품
> 결정이라 동결의 목적("마이그레이션이 프론트를 건드리지 않는다") 밖이었다.

> **동결의 범위 (2026-08-16 해석).** 동결 대상은 **와이어 계약**이다 —
> `wsEvents.ts`와 `room/api/*`·`shared/api/*`의 사용부. 화면·스타일·공용
> 컴포넌트는 계약을 건드리지 않으므로 동결과 무관하다(아래 디자인 시스템 작업
> 5건이 그 선례다). 백엔드는 "이식 완료"지만 e2e:real·MySQL 통합이 미검증이라
> 동결을 아직 풀지 않는다
([backend ADR-0002](../backend/docs/adr/0002-strangler-wire-contract.md)).
문서·테스트·포트폴리오 작업은 동결과 무관하다.

## 대기 중인 이관 티켓 (동결 해제 후)

| 작업 | 내용 | 근거 |
|---|---|---|
| envelope 게임 무관화 | `wsEvents.ts → yacht/domain/*` 결합 해소 — 게임 무관 envelope + 게임별 payload로 분리 | DESIGN.md 경계 예외 1 |
| GameResult 콜백화 | `yacht/screens/GameResult.tsx → room/api/useGameApi` 직접 호출 제거 — `GamePage`가 콜백으로 내려준다 | DESIGN.md 경계 예외 2 |
| sys.reconnect 라우팅 (티켓 25) | 서버에 `sys.reconnect` 처리 추가 또는 이벤트를 계약에서 제거 — 현재는 보내면 조용히 버려져 `room.join` 재전송으로 우회 중 | IMPLEMENTATION_NOTES 2026-08-14 |

계약을 바꾸는 작업은 모두 백엔드와 함께 결정한다 — 시작할 때 이 문서에 계획을
구체화하고(목표·관련 설계·불변식·검증), 백엔드 PLANS.md와 상호 링크를 건다.

---

## 컨트롤러 링크 — 계약 변경 (2026-08-27, 진행 중)

> 파티 모드에서 컨트롤러 폰의 **연출 신호**를 서버를 거치지 않고 큰 화면에 직접 보낸다.
> 서버 쪽 계획은 [backend/PLANS.md](../backend/PLANS.md) 「컨트롤러 링크 시그널링」 절.
> 끝나면 이 절을 지우고 결과를 `docs/llmwiki/controller-link.md`에 반영한다.

### 목표

컨트롤러 신호는 지금 `폰 → 서버 → 큰 화면` 두 홉을 지난다. 그중 야추의
`dice.shake`·`dice.throw`는 **서버가 판정하지 않고 그대로 중계만 하는 연출 릴레이**라,
폰과 큰 화면을 WebRTC DataChannel로 직접 이으면 홉 하나와 서버 처리, 그리고 60ms 주기
펄스가 겪는 TCP head-of-line blocking이 사라진다.

**옮길 수 있는 것은 그 둘뿐이다.** 컨트롤러 메시지 9종을 전수 확인한 결과다.

| 메시지 | 링크 | 왜 |
|---|:--:|---|
| `game.yacht_dice.dice.shake` · `dice.throw` | ✅ | 서버가 중계만 한다 |
| `dice.roll` · `dice.hold` · `round.submit` | ❌ | 서버가 굴리고·저장하고·확정한다 |
| `game.ping_pong.swing` · `ready` | ❌ | 서버가 `clientTs`로 되감아 판정한다 |
| `game.duel.draw` | ❌ | 판정도 서버이고, **연출용으로 곁들여 보내도 안 된다** — 무대 불변식(상대 총알·기록은 판정 후에만)을 깬다 |

서버는 WebSocket만 말하므로 권위 메시지는 링크로 갈 수 없다. 즉 "컨트롤러 연결을 통째로
RTC로"는 원리적으로 불가능하고, 이 작업의 범위는 연출 릴레이 한 갈래다.

### 관련 설계

- DESIGN.md 원칙 1(서버 권위) — 링크에 태울 수 있는 것의 경계가 여기서 나온다
- [realtime.md](docs/llmwiki/realtime.md) 「관전 연출 이벤트의 유래」 — 두 이벤트가
  존재하는 이유가 곧 "빨리 도착하는 것이 품질"이라는 근거다
- [room-and-session.md](docs/llmwiki/room-and-session.md) 「파티 모드」 — 대시보드가
  플레이어 명단에 없다는 사실이 협상 방향을 정한다

### 계약 변경 — 시그널링 메시지 2개 추가

`ctrl.signal`(C→S, `{to, data}`)과 `ctrl.signaled`(S→C, `{from, data}`)를 넣는다.
서버는 `data`를 파싱하지 않고 지목된 상대에게만 유니캐스트한다.

- **넓히기다.** 기존 메시지는 하나도 바꾸지 않는다. `ctrl.*`를 모르는 서버·클라이언트와
  섞이면 협상이 조용히 실패해 링크가 안 열리고, 화면은 지금까지와 똑같이 동작한다.
- **처음 계획은 `voice.signal`에 얹는 것이었다.** 그 릴레이가 이미 방 스코프 불투명
  유니캐스트였기 때문이다. 음성 삭제(위 절)로 그 경로가 사라져 새 타입이 유일한 길이 됐다.
  기각한 대안과 이 반전의 기록은 [ADR-0002](docs/adr/0002-controller-link-signaling.md).
- **`chat.*`을 재사용하지 않는다** — 방 전체 브로드캐스트이고 글자 수·도배 한도가 걸려
  있어 SDP를 실을 수 없다.

### TURN을 붙이지 않는다 (STUN만)

링크가 TURN 릴레이를 타면 경로가 `폰 → TURN → TV`가 되어 **없애려던 서버 홉이 되살아난다.**
WebSocket 폴백이 같은 홉 수로 이미 같은 일을 하므로, TURN은 대역폭과 coturn 운영과 포트
개방을 지불하고 얻는 것이 없다. 음성과 갈리는 지점이 여기다 — 음성에는 폴백이 없었다.

STUN은 유지한다. 트래픽이 지나가지 않아 비용이 없고, 손님 폰이 집주인 와이파이에 붙지
않은 경우(LTE)를 덮는다. 음성과 함께 `GET /voice/ice`가 사라졌으므로 **프론트 상수로
박는다** — 발급 엔드포인트를 되살리지 않는다(인증 없는 TURN 자격 발급이 무단 사용
표면이었다는 판단도 함께 반영한다).

### 불변식

1. **서버가 판정·저장하는 메시지는 링크에 태우지 않는다.** 판정표가 목록의 정본이다
2. **두 경로로 동시에 보내지 않는다.** 파티 모드에서 두 이벤트를 소비하는 화면은
   대시보드뿐이라, 링크가 닿았으면 서버 릴레이는 같은 그림을 한 번 더 그리는 일이다
3. **폴백은 호출부에서 보인다.** `trySend`가 false를 돌려주고 호출부가 WebSocket으로
   보낸다. 링크 안에 감추면 "무엇이 서버를 거쳤는가"가 안 보인다
4. **`playerId`는 서버가 찍어 준 `from`을 쓴다.** 프레임 안의 주장을 믿으면 사칭이 된다
5. **협상은 대시보드가 먼저 건다.** 서버가 대시보드를 명단에 넣지 않아 폰은 상대 id를
   모른다. 역할이 비대칭이라 glare가 생기지 않는다
6. 받은 프레임은 서버가 뿌렸을 봉투와 같은 모양으로 바꿔 `client.deliverLocal()`로
   같은 팬아웃에 흘린다 — **소비자는 어느 전송을 타고 왔는지 모른다**

### 검증

- 단위: 릴레이 변환·프레임 파싱(순수), 협상 순서와 채널 선택, 역할 판정, **폴백 4경우**
  (링크 없음·링크 열림·킵은 항상 서버·채널 닫힘)
- 계약: 백엔드 `ws/__tests__`에 릴레이 케이스(from 스푸핑 차단, 부재 상대 무음 드롭)
- 프론트 전체: `check` · `typecheck` · `test` · `check:cycles` · `build`
- **미검증으로 남는 것: 실기기 지연 측정.** 절감 근거는 구조적인 것뿐이다. 링크에 RTT
  프로브(`useControllerLink().rttMs()`)를 넣어 두었지만 화면에 노출하지 않았고, 파티
  방(폰 + TV)이 필요한 검증이라 실기기 티켓에서 닫는다

---

## 음성 채팅 → 텍스트 채팅 (2026-08-27, 완료)

사용자 요청으로 WebRTC 음성 채팅을 방 텍스트 채팅으로 교체했다. 결과 구조·불변식은
[chat.md](docs/llmwiki/chat.md), 서버 쪽은
[backend/docs/design/chat.md](../backend/docs/design/chat.md)와
[backend/PLANS.md](../backend/PLANS.md)의 같은 이름 절.

- **계약**: `voice.join`·`voice.leave`·`voice.signal`·`voice.peers`·`voice.signaled`와
  `GET /voice/ice`를 지우고 `chat.send`(C→S)·`chat.message`(S→C)를 넣었다. **넓히기가
  아니라 교체다** — backend-java로 롤백하면 채팅만 동작하지 않는다(게임·방·인증 경로는
  그대로).
- **사라진 코드**: `realtime/voice/` 전부(풀메시 `voiceMesh`·`useVoiceChat`·
  `PeerMicButton`·`iceServers`), `AudioPopover`의 마이크 행, `AudioStatusIcon`의
  마이크 겹침, `PlayerCard.speaking`·`TurnStrip`의 발화 표시, `IconMic`.
- **새 코드**: `realtime/chat/`(3파일) + 대기실·야추 헤더의 여는 버튼. mock 백엔드는
  `chat.send`를 에코한다.
- **잃은 것을 알고 지웠다**: "누가 말하는 중" 표시(수신기 `audioLevel` 폴링), 상대별
  음소거, TURN 자격 발급 경로. 풀메시 세 규칙(offer 방향·ICE 후보 큐·failed 재협상)의
  근거는 `code-rationale.md`에서 함께 지웠으므로, 음성을 되살리려면 git 이력을 본다
  (`git log -p -- frontend/src/realtime/voice`).
- **남은 판단 1건**: 대화를 서버가 저장하지 않으므로 **새로고침·재접속하면 지난 대화가
  사라진다.** 방 수명이 게임 한 판이라 지금은 그 값이 비용을 넘지 않는다고 봤다.
  바꾸려면 서버에 방별 링 버퍼를 두고 `room.joined`·`sys.reconnected` 스냅샷에 싣는
  것이 최소 변경인데, 그것은 계약을 다시 넓히는 일이다.

## 테마 토글을 헤더로 (2026-08-27, 완료)

계정 다이얼로그 안에 있던 「화면 테마」 3분할 라디오(시스템/다크/라이트)를 랜딩 헤더의
아이콘 토글 하나로 옮겼다. 소리 토글 옆이다.

- **왜**: 테마는 계정 설정이 아니라 기기 설정인데, 모달을 열어야 닿는 자리에 있으면
  첫 화면이 눈부실 때 그것을 고칠 방법이 보이지 않는다.
- **잃은 것**: `system`(OS 따라가기)을 **다시 고를 수 없다.** 한 버튼으로 세 값을
  돌리면 다음 상태를 예측할 수 없어 두 값만 오가게 했다. 기본값은 여전히 `system`이므로
  토글을 한 번도 누르지 않은 사용자는 그대로 OS를 따라간다. 되돌리려면 헤더 토글을
  두고 다이얼로그에 3분할을 함께 남기는 쪽이 다음 후보다.
- **새로 생긴 상태**: `store.resolvedTheme`. 선택이 `system`일 때 실제 적용값을
  아이콘이 그려야 하는데 선택만으로는 알 수 없어서다. 갱신은 `setThemePreference`와
  `useThemeSync`(OS 변화 감시) 두 곳뿐이다.

## 디자인 시스템 — 스타일 변경 대응력 확보 (진행 중)

> **목표는 라이트 모드다.** 테마를 추가할 수 있는 구조를 먼저 만드는 중이며,
> 라이트 모드 구현 자체는 아직 시작하지 않았다. 이 절은 어디까지 왔고 무엇이
> 남았는지를 기록한다. 끝나면 이 절을 지우고 결과를 DESIGN.md·
> [design-system.md](docs/llmwiki/design-system.md)에 반영한다.

### 왜 하는가 — 최초 진단 (2026-08-16 실측)

`src/` 전체 tsx 23,195줄 · `className` 1,124곳을 성격별로 세었다.

| 성격 | 인라인 등장 | 중앙 흡수층 |
|---|---|---|
| 색·테두리 | 1,537 | ✅ `tokens.css` 색 토큰 84개, 2계층 |
| 레이아웃·간격·크기·포지션 | **2,760** | ❌ 없음 |

**문제는 밀집도가 아니라 흡수층의 비대칭이었다.** 색은 이미 중앙화돼 팔레트
변경이 `--ds-*` 한 곳에서 끝나지만, 조합을 흡수하는 컴포넌트 층이 없어 배치
결정이 1,124곳에 흩어져 있었다. `design-system.md` 규칙 1이 이미 그 구조를
요구하는데(공통 프리미티브 → 얇은 래퍼로 분기, 선례 `GameChromeButton`)
프리미티브가 14개뿐이라 분기칠 몸통이 없었다.

### 끝난 것 (PR #13 · #14 · #15 · #16, 전부 main 병합)

프리미티브 4종 추가 — **#16을 뺀 셋은 겉모습 무변화**다.

| 프리미티브 | 사용 | 흡수한 결정 |
|---|---|---|
| `Alert` | 14곳 | tone 3종. **`role`을 톤이 정한다**(danger→alert, positive→status, neutral 없음) |
| `Badge` | 13곳 | tone 3종. 크기는 호출부 몫 |
| `Panel` | 33곳 | surface 3종 + `as`로 시맨틱 태그. 패딩 기본값 없음 |
| `GameCanvas` | 14곳 | `Screen.tsx`. 게임 캔버스 프레임. 배경색은 도메인 팔레트라 안 든다 |

문서에 굳힌 규칙 3개 — **컴포넌트보다 이쪽이 오래간다.**

1. **위계가 바뀌면 `variant`, 색만 바뀌면 `tone`** (DESIGN.md 원칙 8). 새 이름
   (`kind`·`type`·`level`)을 만들지 않는다
2. **행이면 `card`, 상자면 `panel`** (design-system.md 사다리 절). 라운드가
   panel 13 : card 14로 반반이었는데 갈리는 기준이 크기가 아니라 모양이었다 —
   card 14곳 중 10곳이 `px`/`py`만 쓰는 행이었다
3. **`gap`은 `1 · 1.5 · 2 · 3 · 4 · 6` 6단.** 사다리 밖이 필요하면 가장 가까운
   단, 동점이면 좁은 쪽(320px 하한에서 넓히면 넘칠 위험)

곁가지로 `biome.json`의 `lineEnding`을 `crlf` → `lf`로 고쳤다. 저장소에 CR이 든
파일이 0개인데 설정만 crlf여서 `npm run check`가 460개 에러로 죽어 있었다.

### 아직 안 된 것 — 여기가 다음 세션의 출발점

**총량 지표는 거의 안 움직였다**(배치 2,760 → 2,750). 프리미티브가 흡수한 건
74곳이고 나머지는 그대로다. 즉 **"컴포넌트 하나의 모양"은 바꾸기 쉬워졌지만
"전체의 리듬·테마·위계"는 여전히 전수 수정이다.**

| 순위 | 남은 격차 | 곳 | 판정 (2026-08-18 재실측) |
|---|---|---|---|
| ~~1~~ | ~~하드코딩 색~~ | ~~78~~ | ✅ **완료** — 예외 6곳만 raw(전부 주석) |
| ~~2~~ | ~~생 `<button>`~~ | ~~93~~ | ✅ **판정 완료** — 재실측 59곳(93은 낡은 수). 게임 액션 버튼 9곳은 `PingPongButton`·`DuelButton`으로 흡수, 나머지 50곳은 전부 정당 갈래(분류는 design-system.md 규칙 1) |
| ~~3~~ | ~~간격 토큰화~~ | ~~965~~ | ✅ **전제가 틀렸다** — Tailwind v4가 이미 전 간격을 `calc(var(--spacing)×N)`으로 컴파일한다. "전체를 20% 촘촘하게"는 `--spacing` 한 줄이다. 변수를 우회하는 임의값은 26곳뿐이고 전부 safe-area·뷰포트 기하라 정당 |
| ~~4~~ | ~~타이포 토큰화~~ | ~~428~~ | ✅ **같은 판정** — 전 글자가 `var(--text-*)`로 컴파일된다. 스케일 1파일화는 이미 있다. 임의값 6곳은 디스플레이 숫자(404·워터마크·카운트다운) |
| ~~—~~ | ~~200줄 초과, 이유 주석 없음~~ | ~~10~~ | ✅ **완료** — 재실측 7개. `Arena` 915줄은 성격별 5조각으로 분할, `Popover`는 배치 산술을 추출, 나머지 5개는 각자 **정직한 유지 이유**를 주석으로(RealtimeSync는 이관 티켓과 함께 갈라야 diff가 안 묻힌다 등) |

`gap` 6단 정리(#16)는 3번의 **준비 단계였지 목적지가 아니다** — 288곳이 여전히
호출부에 리터럴로 박혀 있어 "전체를 20% 촘촘하게"는 아직 전수 수정이다. 얻은
것은 "다음 사람이 `gap-2.5`를 새로 만들지 않는다"까지다.

### 라이트 모드 — 끝났다 (2026-08-18) · 요트 트레이 보강 (2026-08-21)

색 회수 78곳 → 테마 층(`[data-theme="light"]`) → 토글·영속·프리페인트 → 대비 검증
→ 테마 선택 UI 노출까지 완료. **노출 자리는 2026-08-27에 옮겼다** — 계정 다이얼로그
안의 3분할 라디오(`ThemeRow`)에서 랜딩 헤더의 해/달 토글(`ThemeToggle`)로. 아래
「테마 토글을 헤더로」 절. 결과는 문서에 반영했다 —
구조·규칙은 [design-system.md](docs/llmwiki/design-system.md)(테마 층·JS 색 읽기 규칙),
부팅 순서는 [app-shell.md](docs/llmwiki/app-shell.md), 과정 기록은
IMPLEMENTATION_NOTES.md 2026-08-18 항목들.

**남아 있던 구멍 하나**(사용자 보고): 요트 게임 화면만 라이트가 안 먹는 것처럼 보였다.
원인은 테마 제외로 정해 뒀던 **3D 트레이**가 모바일에서 화면의 절반을 넘고, 그 위
라벨이 앱 토큰을 써서 검정 위 검정이 된 것이었다. 트레이 팔레트(`physics-tray`·
`tray-shadow`·`rail`·`slot`·`ground`)를 라이트에서 뒤집었다 — **주사위 몸통·눈은
그대로 상아색·검정이다.** 갈리는 기준은 "게임인가"가 아니라 "화면을 혼자 쓰는
무대인가"로 정리했다(design-system.md 「라이트에서 덮는 것」). 톤매핑·알파 함정은
IMPLEMENTATION_NOTES.md 2026-08-21.

### 요트 라이트 모드 · 연습 방 시계 (2026-08-21)

같은 작업에서 **와이어 계약을 한 곳 넓혔다** — `round.start.deadline`과
`game.roundDeadline`이 `number | null`이 됐고, null이면 제한 시간이 없는 판이다
(봇만 데리고 혼자 하는 방). 서버 쪽 판정·근거는
[backend/PLANS.md](../backend/PLANS.md) 「연습 방 시계 제거」 절. 프론트가 계약의
정본이므로 `wsEvents.ts`를 먼저 고치고 서버를 맞췄다. 넓히기만 했으므로 숫자 마감을
보내는 서버(구 backend-java 롤백 포함)에서도 화면은 그대로 동작한다.

### 열린 결정 2건

- ~~**brand 톤이 두 값이다**~~ → **글자 쪽으로 확정했다 (2026-08-18).** `Badge`
  brand 톤의 글자를 `text-brand` → `text-brand-strong`으로 — LeveragePage가 이미
  쓰던 값이라 **글자 톤은 하나가 됐다**(다크에서 `#e53935`→`#ff4d48`로 밝아지는
  변화 수용, 대비는 4.71→6.08로 오히려 오른다). `brand-soft`가 아닌 이유: soft는
  다크에서 분홍(#ff8a86)까지 밀려 배지의 브랜드 정체성이 흐려진다. 테두리 차이
  (`border-brand/40` 대 `border-brand bg-brand/15`)는 컴포넌트 몫으로 남긴다 —
  같은 톤 이름 아래 강도가 다른 것은 규칙 위반이 아니다
- **`gap-0.5` 되돌릴 자리.** 6단으로 좁히며 `0.5`(2px) → `1`(4px)로 올린 10곳은
  전부 **라벨+값 두 줄 묶음의 행간**이었다(`grid gap-0.5`·`flex flex-col gap-0.5`,
  AccountMenu·DuelController·ModeRow·TurnStatus 등 4개 도메인). 뜨게 느껴지면
  여기가 되돌릴 지점이다

### 손대지 않기로 한 것 (이유 있음)

- `Modal` → `Panel` — `motion.section`이라 모션 variants 배선이 통과하지 못한다
- `ReactionDock` → `Panel` — `bg-surface-overlay/95`로 표면 사다리에 없는 값
- `PlayModeDialog:42` · `MotionPermissionPanel:21` → `Alert` — 제목·버튼을 품은
  강조 패널이지 알림 한 문장이 아니다. `role="alert"`를 달면 정적 패널을
  스크린리더가 계속 읽는다. `Panel` 계열의 몫
- 남은 `h-svh` 10곳 → `GameCanvas` — `LobbyPage`·`AuthCallbackPage`·
  `LeveragePage`·`GameResult`·`PartyOpeningNotice`·dev 화면. 성격이 제각각이라
  각각 판단이 필요하다

### 검증 수단 — 메웠다 (2026-08-18)

`npm run test:visual`. 한 기계 안에서 main과 작업 브랜치의 `/__dev/components`를
섹션 단위로 찍어 대조한다. 사용법·제외 섹션은
[testing.md](docs/llmwiki/testing.md)「시각 대조」.

착수 전 세워 뒀던 전제 두 개가 실측에서 틀렸다.

- **"baseline은 CI 환경에서 떠야 한다 — 아니면 CI가 영구히 빨개진다."** 프론트 CI
  (`.github/workflows/frontend.yml`)는 `check`·`typecheck`·`test`·`build`·
  `check:cycles`만 돌린다 — **Playwright를 실행하지 않는다**(구 Jenkins 파이프라인도
  그랬다). 빨개질 CI가 없으니 이 제약도 없다. 대신 baseline을 지켜 줄 CI도 없다는
  뜻이라, **저장소에 넣지 않고** before/after 대조로만 쓴다.
- **"카탈로그 한 장이면 프리미티브 전체가 커버된다."** 실제로는 shared 17종 중
  7종이었다(`Alert`·`Badge`·`Button`·`Modal`·`Panel`·`TextField`·`Tooltip`).
  아래 색 회수가 건드리는 `GameChromeButton`·`BottomSheet` 두 종을 등재했고, 나머지
  8종(`ConnectionBanner`·`ToastHost`·`Popover`·`LoadingOverlay`·`Screen`·`Icon`·
  `AudioPopover`·`AudioStatusIcon`)은 그것을 고칠 때 등재한다.

카탈로그는 **페이지 한 장이 아니라 섹션 단위**로 찍는다 — 물리 주사위 렌더러·음성
랩·마스코트 가이드가 매 프레임 달라 한 장으로는 매번 diff가 난다.

### 작업 규약

- PR은 작게 — 지금까지 9~15파일, +90~210줄 수준으로 끊었다
- **실측 먼저.** 이 절의 모든 판단은 `grep` 집계에서 나왔다. 추정으로 잡았던
  "Alert 22곳"은 실제로 4곳이었다 — 세고 나서 만든다
- 새 프리미티브는 `/__dev/components` 카탈로그 등재 + `__tests__` +
  shared-ui.md 인벤토리 한 줄까지가 한 단위다
