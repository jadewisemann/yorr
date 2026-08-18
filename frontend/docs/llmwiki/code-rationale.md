# 코드 근거 — 지우면 다시 밟는 함정들

> 코드에서 주석을 걷어내면서, **실측값·실패한 대안·"이렇게 바꾸면 깨진다"** 만 여기로 옮겼다.
> 값을 바꾸거나 "단순화"하기 전에 해당 심볼을 여기서 먼저 찾아본다.
>
> 나머지 주석은 지웠고 git 이력에 남아 있다 — `git log -p <파일>` 로 언제든 되찾는다.
> 자동 추출이라 문장이 끊긴 곳이 있다. 원문이 필요하면 이력을 본다.

총 85건 / 55파일

### `src/app/dev/HandVoiceLab.tsx`

- **const target = event.target**
  // 카탈로그에는 입력 필드도 있다 — 거기 타이핑하는 숫자로 소리가 나면 안 된다.

### `src/app/dev/MotionLabRecorder.tsx`

- **export function MotionLabRecorder({**
  * 원시 센서 스트림 녹화·리플레이 패널. 폰에서 한 번 녹화해 두면 * 데스크톱에서 config만 바꿔가며 판정 결과를 결정적으로 재현할 수 있다.

### `src/app/dev/motionLabReplay.ts`

- **export function replayRecording(**
  * 녹화를 프로덕션 파이프라인(normalizer → recognizer)에 그대로 통과시킨다. * 이벤트의 at은 녹화 시작 기준 경과 ms — 라이브와 달리 결정적으로 재현된다.

### `src/app/RealtimeSync.tsx`

- **function rejoinRoom(client: RealtimeClient): boolean {**
  * 재접속도 room.join으로 통일한다. 서버가 sessionToken으로 기존 정체성을 복원하며, * sys.reconnect는 아직 서버에 라우팅이 없어 보내면 조용히 버려진다(티켓 25에서 이관). * @returns 다시 참가를 보냈는지 — 실패 시(로컬 세션 없음) 재연결 횟수를 리셋하지 않는다.
- **function applyRoundStart(**
  * round.start는 새 턴에만 오는 게 아니다 — 서버는 굴림마다 마감을 연장하며 같은 턴에도 * 다시 보낸다. 그래서 굴림 진행을 무조건 0으로 되돌리면 안 된다. 턴이 실제로 바뀌었을 * 때만 초기화하고, 같은 턴이면 지금까지의 진행을 그대로 들고 간다.

### `src/auth/api/authApi.ts`

- **export async function closeSession(sessionToken: string) {**
  서버 세션을 닫는다. 실패해도 클라이언트는 로컬을 지운다 — 로그아웃이 서버 사정에 묶이면 안 된다.

### `src/auth/model/useAuthSessionCheck.ts`

- **export function useAuthSessionCheck() {**
  * 앱이 뜰 때 저장된 로그인 세션이 서버에서도 살아 있는지 한 번 확인한다. * <p> * 로그인 상태는 로컬에 저장해 두고 복원하는데, 그 사이 서버 세션이 사라졌을 수 있다 * (만료 · 다른 기기에서 로그아웃 · 서버 데이터 초기화). 그러면 <b>화면은 로그인인데 요청은 * 401</b>인 상태가 되고, 사용자는 무엇이 잘못됐는지 알 방법이 없다. * <p> * 죽었으면 <b>조용히</b> 정리한다 — 사용자가 한 일이 없으므로 "로그아웃되었습니다" 같은 * 안내는 오히려 놀라움을 만든다. 서버가 잠깐 안 뜬 경우(401이 아닌 실패)는 건드리지 않는다.

### `src/duel/domain/duel.ts`

- **export const SWING_THRESHOLD = 15**
  * 뽑기로 인정할 스윙 세기(`useSwing` 기본값 14보다 조금 높다 — 총을 뽑는 동작은 라켓을 * 휘두르는 것보다 짧고 급하다). * * 대기실 연습과 실제 게임이 <b>같은 값</b>을 써야 한다. 연습에서 감지된 동작이 게임에서 * 안 잡히면 "연습은 됐는데 게임에서 안 된다"가 되고, 그건 고장으로 읽힌다.
- **const MIN_FLIGHT_MS = 260**
  * 좁은 화면의 하한. 등속으로 두면 폰에서 130ms인데, 그러면 판정이 도착하기도 전에 총알이 * 닿아 버려 피격이 늘 총알보다 늦는다(실측 63ms 지각). 왕복 지연을 덮을 만큼은 날아야 * 착탄과 피격이 같은 프레임에 온다.
- **export function missTaunt(seed: number): string {**
  * 이 라운드의 비아냥. 난수를 쓰지 않는다 — 두 사람이 <b>같은 말</b>을 봐야 하고, 같은 * 라운드를 다시 그려도(재접속·리렌더) 말이 바뀌면 안 된다. 그래서 서버가 준 값에서 뽑는다.

### `src/duel/domain/fighter.ts`

- **export interface Outfit {**
  * 진영 색 — 스카프·모자띠·총구 화염에 쓰여 두 캐릭터를 구분한다. * * 컴포넌트가 아니라 여기 있는 이유: `stage.ts`가 서버 상태를 무대 props로 번역할 때 이 값을 * 읽는다. `Gunslinger.tsx`에 두면 순수 번역 모듈이 컴포넌트 파일을 값으로 참조하게 되어 * `domain/`이 React를 모른다는 규칙이 깨진다.

### `src/duel/model/useDuelGame.ts`

- **const MEASURED_PAINT_LAG_MS = 45**
  * 피격 타이머를 이만큼 앞당겨 깨운다. setTimeout이 깨어난 뒤 React 렌더와 페인트가 한두 * 프레임 더 걸려, 보정 없이 재면 자세가 총알보다 50~60ms 늦게 바뀐다(실측).
- **function useStageWidth(ref: RefObject<HTMLElement | null>): number {**
  * 무대의 실제 폭. 총알 사거리가 여기서 나오므로 창 크기가 바뀌면 다시 잰다. * 첫 렌더에도 값이 있어야 하므로(그 라운드의 착탄 시각을 이미 잡아야 한다) 뷰포트 폭으로 * 시작하고, 마운트 직후 실측으로 바꾼다.
- **function sendAfter(penaltyMs: number, send: () => void): number {**
  * 페널티만큼 늦춰서 보낸다. 취소할 수 있게 타이머 id를 돌려준다(0이면 지금 보내고 null). * * <b>왜 늦추는가.</b> 신고 숫자만 키워 보내면 서버가 깎아 버린다 — `DuelRules.draw`가 받은 * 값을 `now - signalAt`(= 실제 반응 + 왕복 지연)으로 clamp하므로, 왕복이 짧은 회선에서는 * 얹은 100ms가 통째로 사라진다. 그러면 밸런스가 회선 속도에 따라 달라진다(로컬 개발에서는 * 페널티가 아예 없다). 전송을 늦추면 서버의 기준 시각도 그만큼 뒤로 밀려 깎이지 않는다.
- **useLayoutEffect(() => {**
  /* * 이벤트 경로(draw)가 읽는 두 값을 페인트 직전에 맞춰 둔다. * * useEffect가 아니라 useLayoutEffect다 — 사람은 화면에 칠해진 신호를 보고 반응하고, * layout effect는 그 페인트보다 먼저 돈다. 그래서 아무리 빠른 탭도 기준 시각이 비어 있는 * 창에 들어오지 못한다(useEffect는 페인트 뒤라 그 창이 열린다). * * signalSeenAt: 내가 신호를 본 시각. 반응 시간을 서버 도착 시각으로 재면 왕복 지연이 * 그대로 핸디캡이 되므로 각자 자기 화면 기준으로 재서 올린다(서버가 상한만 검증한다). * 신호 국면이 아니면 비운다 — 다음 라운드가 지난 라운드의 기준으로 재면 안 된다.
- **const hitId = state?.lastRound?.hitId**
  // 총알이 닿는 순간 — 피격 자세와 체력 감소를 여기에 맞춘다. 서버 시각(lastRound.at)이 // 아니라 로컬 타이머로 세는 이유는 두 기기의 시계가 맞다는 보장이 없기 때문이다. // // 타이머는 CSS 지연보다 늦게 도착한다 — 타이머가 깨어난 뒤 React가 다시 렌더하고 화면에 // 칠해지기까지 한두 프레임이 더 걸린다. 실측 50~60ms였다. 그만큼 앞당겨 깨워야 자세가 // 총알과 같은 프레임에 바뀐다. CSS 지연(impactDelay)에는 이 보정을 넣지 않는다. // // 두 id를 effect 밖에서 꺼내 두는 이유: 안에서 lastRound를 통째로 잡으면 그 객체가 // 의존성이 되고, 서버 갱신마다 참조가 바뀌어 착탄 타이머가 매번 리셋된다.
- **useEffect(() => () => window.clearTimeout(penaltyTimer.current), [])**
  // 방을 떠나면 기다리던 전송을 취소한다 — 이미 나온 방에 뽑기가 기록되면 안 된다.

### `src/duel/screens/DuelResult.tsx`

- **const OUTCOME_COLOR: Record<DuelOutcome, string> = {**
  * 결과 색. 무승부는 이기지도 지지도 않았으므로 승리 초록도 패배 빨강도 아닌 본문 아이보리다 — * 색만 보고 결과를 읽는 사람에게 중립이 「이겼다」로 읽히면 안 된다.
- **{outcome === 'draw' ? 'Standoff' : 'Last man standing'}**
  {/* 무승부에는 아무도 마지막까지 서 있지 않았다 — 눈썹 문구가 결과와 어긋나면 안 된다.

### `src/landing/components/HeroCanvas.tsx`

- **export function HeroCanvas({ game }: HeroCanvasProps) {**
  * 랜딩 히어로의 3D 레이어. 순수 장식이라 초기 번들에 three.js를 싣지 않고 지연 로드하고, * WebGL을 못 쓰는 환경에서는 배경 그라디언트만 남긴 채 조용히 비운다.

### `src/landing/components/LandingHeroCard.tsx`

- **<p className="m-0 line-clamp-2 min-w-0 text-pretty text-[clamp(16px,1.6vw,22px)]/[1.3] font-semibold text-landing-text-strong">**
  // line-clamp-2: 액션 클러스터가 버튼 두 개로 넓어져 760px에서 이 칸에 83px밖에 // 남지 않는다. 접히는 줄 수를 묶지 않으면 하단 띠가 두꺼워지고 그만큼 3D 영역이 // 깎인다 — 카드 높이 상한(32rem)이 CTA 한 개 시절 값이라 여유가 없다.

### `src/landing/components/LandingHeroCarousel.tsx`

- **function NeighborCard({**
  * 양옆에 서는 이웃 카드. 두 레이아웃이 하는 일이 다르다. * <p> * <b>wide</b>는 띠 <b>안쪽</b>에 온전히 선다(예전엔 -12.2%로 걸쳐 있어 화면 밖으로 잘려 * 나갔다). 카드 석 장이 한 화면에 함께 보이고, 이웃 카드를 눌러 바로 그 게임으로 넘어간다. * 가운데 카드 폭(69.4%)은 건드리지 않는다 — 760px에서 이미 하단 띠의 태그라인 칸이 83px뿐이라 * 여기서 더 좁히면 액션 클러스터에 밀려 글자가 깨진다({@link LandingHeroCard} 하단 띠 주석). * 그래서 이웃은 남는 갓길(양쪽 15.3%)에 들어간다. * <p> * <b>narrow</b>는 종전 그대로 "옆에 더 있다"만 말하는 장식이다. 390px에서 내보일 수 있는 * 폭이 35px이라 탭 타깃이 되지 못하고, 포인터를 받으면 스와이프와 다툰다. * <p> * 3D는 가운데 카드만 그린다 — 이웃은 {@link LandingHeroCard}가 아니라 이 정적 판이므로 * 카드가 셋 보여도 살아 있는 HeroCanvas는 여전히 하나다.

### `src/landing/components/RankingTicker/parts.tsx`

- **export function EmptyNotice({ loading }: { loading: boolean }) {**
  * 아직 아무 기록도 없는 주. 빈 띠를 두는 대신 "여기 오를 수 있다"를 말한다 — 로그인해야 * 오를 수 있으므로 이 자리가 곧 로그인할 이유가 된다. * <p> * 읽어오는 중에는 문구를 감추되 띠 높이는 그대로 둔다. 뒤늦게 나타나면 그만큼 히어로가 * 줄어들며 화면이 한 번 튄다.

### `src/landing/model/useEntryPage.tsx`

- **if (authSession) void closeSession(authSession.sessionToken).catch(() => {})**
  // 서버 세션도 닫는다. 로컬만 지우면 그 토큰은 남은 30일 동안 서버에서 유효한 채로 남는다. // 실패해도 기다리지 않는다 — 로그아웃이 서버 사정에 묶이면 안 된다.

### `src/landing/model/useHeroCarousel.ts`

- **const DRAG_ACTIVATION_PX = 8**
  * 이 거리를 넘긴 뒤에야 "끄는 중"으로 승격한다. 그 전에는 띠를 1px도 움직이지 않고 * 포인터도 캡처하지 않는다 — 카드 안 플레이 CTA 위에서 시작한 탭이 손가락 흔들림 몇 px에 * 드래그로 뒤집히면 버튼을 영영 못 누른다. 브라우저 터치 슬롭과 같은 8px.
- **const trackX = useMotionValue<number | string>(0)**
  /** * 띠의 x는 MotionValue + 명령형 {@link animate}로 움직인다. useAnimationControls의 * start()는 이 조합(레이아웃 이펙트 안 set→start)에서 애니메이션을 시작하지 못해 띠가 * 출발점(±43%)에 그대로 주차됐다 — 카드가 화면 밖에 멈춘 채로 남는 실측 버그.
- **const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {**
  /** * 카드 안에 플레이 CTA가 들어오면서 규칙이 바뀌었다. 예전에는 `closest('button')`이면 * 드래그를 아예 시작하지 않았는데, 그 규칙을 두면 카드 폭을 꽉 채운 CTA 위에서 스와이프가 * 죽는다 — 모바일에서 엄지가 가장 먼저 닿는 자리다. * <p> * 대신 <b>임계값으로 가른다</b>: 8px을 넘기기 전에는 아무 일도 없고, 넘긴 뒤에야 포인터를 * 캡처한다. pointerdown에서 캡처하면 안 된다 — 캡처가 걸린 순간부터 호환 마우스 이벤트가 * 이 섹션으로 재타깃돼 카드 안 버튼의 click이 <b>아예 발화하지 않는다.</b>
- **const handleClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {**
  /** * 드래그로 끝난 제스처 뒤에 따라오는 click을 캡처 단계에서 삼킨다. CTA 위에서 스와이프를 * 시작했다가 손을 떼는 순간 게임이 시작되면 안 된다. 캡처 단계라 버튼 자신의 onClick보다 * 먼저 돌아 여기서 끊긴다. detail === 0은 키보드가 만든 click이라 통과시킨다.
- **function keyboardStep(event: globalThis.KeyboardEvent) {**
  * 이 키 입력이 캐러셀을 몇 칸 움직여야 하는가(아니면 0). 거르는 것은 둘이다. * * - `defaultPrevented` — 진행 표시줄 tablist가 이미 처리한 키다. 안 거르면 한 번 눌러 *   두 칸 넘어간다. * - 입력 요소·열린 다이얼로그 안에서 난 키 — 코드를 타이핑하는 동안 뒤에서 캐러셀이 *   같이 미끄러지면 안 된다.

### `src/landing/rendering/heroScene.ts`

- **if (!shared.has(node.geometry)) node.geometry.dispose()**
  // 주사위 지오메트리·재질은 장면 전체가 공유한다 — 게임을 바꿀 때 버리면 안 된다.

### `src/pingpong/rendering/scene3d.ts`

- **const show = s.playing && incoming && !s.ballHit && !s.ballFault && dv > W1_LO - 0.14**
  // 죽은 공엔 링을 띄우지 않는다 — 칠 수 없는 공에 타이밍을 재게 하면 안 된다

### `src/realtime/peerInput.ts`

- **}**
  // 스윙 하나를 못 보낸 것뿐이다. 다시 휘두르면 된다 — 재전송 큐를 둘 만한 값이 아니다. // (같은 이유로 useVoiceChat의 sendSignal도 조용히 버린다.)

### `src/realtime/voice/iceServers.ts`

- **export async function loadIceServers(): Promise<RTCIceServer[]> {**
  * TURN 자격증명을 받아온다. 실패하면 통화를 막지 않고 STUN만으로 진행한다. * * 주소는 반드시 `API_BASE_URL`로 만든다. `/api/v1/...`을 직접 쓰면 Vercel 배포본에서 * rewrite에 걸려 index.html이 200으로 돌아오고, json() 파싱 실패가 조용히 fallback으로 * 떨어져 TURN이 영원히 안 붙는다(같은 NAT 밖 조합은 "연결 중"에서 멈춘다). * * `credentials`를 붙이지 않는다. 이 엔드포인트는 쿠키를 보지 않고(식별자는 선택적 * `X-User-Id` 헤더), 백엔드 CORS는 `allowCredentials(false)`에 `Access-Control-Allow-Origin: *`이다. * `include`를 붙이면 브라우저가 그 조합을 거부해 배포본에서 응답이 통째로 버려진다 — * 다른 REST 호출(`apiRequest`)도 credentials를 쓰지 않는다. * * ⚠️ 자격증명에 수명이 있으므로 결과를 앱 수명 내내 캐시하면 안 된다. 통화를 시작할 때마다 *    부른다 — 6인 방에서 한 번씩이라 호출량이 문제 되는 규모가 아니다.

### `src/realtime/voice/useVoiceChat.ts`

- **setMutedPeers(new Set())**
  // 통화를 끄면 mesh와 함께 사라지므로 화면 상태도 비운다 — 다음 통화에 남아 있으면 // 껐던 기억이 없는 사람의 소리가 조용히 안 들린다.

### `src/realtime/voice/voiceMesh.ts`

- **/****
  * WebRTC 풀메시 한 벌. React를 모른다 — 훅(useVoiceChat)이 이걸 감싸고 화면에 상태를 흘린다. * * 왜 라이브러리를 안 쓰는가: simple-peer·peerjs는 이 파일이 하는 일을 대신하지만, 아래 * "누가 offer를 만드는가"와 "후보 큐"를 감춘다. 6인 메시에서 필요한 건 그 두 규칙이 전부고, * 감춰지면 문제가 생겼을 때 라이브러리 내부를 읽어야 한다. * * ── 규칙 1: offer는 playerId가 작은 쪽만 만든다 *   양쪽이 동시에 offer를 보내면 협상이 깨진다(glare). 계약(wsEvents.ts)에 적힌 대로 *   문자열 비교로 한쪽만 offer를 만들면 perfect negotiation의 복잡한 롤백이 필요 없다. * * ── 규칙 2: remote description 전에 온 ICE 후보는 큐에 쌓는다 *   addIceCandidate는 remote description이 없으면 던진다. 그런데 상대의 후보는 offer/answer *   보다 먼저 도착할 수 있다(별개 메시지라 순서 보장이 없다). 큐가 없으면 통화가 간헐적으로 *   안 붙고, 재현이 어려운 쪽으로 실패한다. * * ── 규칙 3: failed면 스스로 다시 협상한다 *   명단(voice.peers)은 사람이 들락날락할 때만 온다. 죽은 연결을 버리고 기다리기만 하면 *   명단이 다시 오지 않는 방에서는 영구히 "연결 중"이다. 폰은 화면 잠금·WiFi↔LTE 전환에서 *   실제로 여기 걸린다.
- **if (data.kind === 'input') return**
  // 같은 봉투(voice.signal)로 폰 컨트롤러의 조작도 온다 — 통화와 무관하니 여기서 끊는다. // addPeer보다 먼저 걸러야 한다: 스윙 하나 때문에 RTCPeerConnection이 생기면 안 된다.
- **audio.muted = this.mutedPeers.has(id)**
  // 껐던 상대가 재접속하면 연결이 새로 만들어진다 — 그때 소리가 다시 나면 안 된다.
- **void audio.play().catch(() => undefined)**
  // 자동재생 차단은 조용히 실패한다 — 마이크 권한을 이미 받은 컨텍스트라 보통 통과한다.

### `src/realtime/wsEvents.ts`

- **/** C→S: 음성 채널 입장. roomId는 envelope. room.join을 마친 뒤에만 유효하다(아니면 NOT_IN_ROOM). */**
  ===== VOICE-001 · WebRTC 음성 시그널링 (130 · 이정현) ✅ ===== * *  풀메시(full mesh)다. 오디오는 피어끼리 **직접** 흐르고, 서버는 "서로를 찾는 정보"만 *  중계한다 — 미디어 서버(SFU)를 두지 않는다. 방 정원이 6명이라 피어당 연결 4~5개, *  업링크 Opus 30kbps × 5 ≈ 150kbps로 감당되는 구간이다. 정원이 늘면 이 선택을 다시 봐야 *  한다(인코딩을 N번 돌리는 비용이 모바일에서 배터리·발열로 먼저 나타난다). * *  서버가 하는 일은 딱 두 가지다. *    1. 음성 채널 명단 관리 — 누가 들어오고 나갔는지 방에 알린다(voice.peers). *    2. voice.signal을 **내용을 열지 않고** 지목된 상대에게 그대로 전달한다. *  SDP·ICE를 서버가 파싱하면 안 된다. 파싱하는 순간 브라우저가 규격을 늘릴 때마다 *  서버를 같이 고쳐야 한다 — 봉투만 보고 배달하면 그 일이 사라진다. * *  offer 충돌(glare) 방지: 두 피어가 동시에 offer를 보내면 협상이 깨진다. **playerId를 *  문자열로 비교해 작은 쪽이 offer를 만든다.** 양쪽 FE가 같은 규칙을 쓰기만 하면 되므로 *  서버는 관여하지 않지만, 규칙이 갈리면 연결이 안 되므로 계약에 적어 둔다. * *  ICE/TURN은 이 계약에 없다 — REST(`GET /api/v1/voice/ice`)가 담당한다. 자격증명이 시간제한 *  토큰이라 방 전체에 브로드캐스트하면 안 되기 때문이다. FE에서 그 자리는 *  `realtime/voice/iceServers.ts` 한 곳이고, 엔드포인트가 없으면 공용 STUN으로 떨어진다. * *  ─ 결정된 사항 (2026-08 · 이 계약은 아래를 전제로 한다) *    · 정원 6인 확정 → 풀메시 유지. 늘리려면 위 업링크 계산부터 다시 본다. *    · 음소거는 상대에게 보이지 않는다 → voice.mute도 muted 플래그도 두지 않는다. *      트랙만 끄므로 남에게는 "말 안 하는 중"으로 보이고, 그걸로 충분하다는 판단이다. *    · TURN 도입 확정(싸피 서버 UDP 개방 확인) → 자격증명은 시간제한 토큰이라 *      `GET /api/v1/voice/ice`로 발급한다. 방 전체에 방송하면 안 되므로 이 계약에는 없다. *    · "누가 말하는 중"은 각 클라가 수신기의 audioLevel을 직접 읽어 그린다 *      (getSynchronizationSources) — 서버로 올리면 말할 때마다 메시지가 나가고 표시도 늦다. *      그래서 계약에 관련 이벤트가 없다.
- **export interface VoiceSignalPayload {**
  * C→S: 지목한 상대에게 시그널을 전달해 달라고 요청한다. from은 서버가 채운다(클라가 주장하는 * 신분을 믿으면 남을 사칭할 수 있다). 상대가 이미 음성 채널을 떠났으면 서버는 조용히 버린다 — * 협상 중 이탈은 정상 상황이라 에러로 만들 이유가 없다. * * ⚠️ ICE 후보는 다른 메시지보다 훨씬 잦다(연결 수립 순간에 몰린다). RATE_LIMITED를 *    room.ready 같은 기준으로 걸면 통화가 안 붙는다 — 이 타입은 한도를 따로 잡아야 한다.

### `src/room/api/roomApi.ts`

- **function toGameState(value: unknown): GameState | undefined {**
  * REST 스냅샷의 진행 상태. 계약 초안(realtime-and-api.md)의 선택 필드라 * 없거나 형태가 다르면 조용히 무시한다 — 진행 상태의 SSOT는 WS(state.sync·round.start)다.

### `src/room/api/useGameApi.ts`

- **function preserveRealtimeGame(snapshot: RoomSnapshot): RoomSnapshot {**
  * REST 스냅샷을 실시간 상태와 합친다. * <p> * REST(`GET /games/:id`)는 새로고침·직접 진입에 대비한 <b>한 번짜리 백필</b>이고, 진행 * 상태의 권위자는 WebSocket이다. 그래서 game뿐 아니라 <b>phase도 되돌리지 않는다</b> — * 응답이 날아오는 사이 `game.over`가 도착하면 이 응답이 finished를 playing으로 덮어 * 결과 화면이 영영 뜨지 않는다. 라우트 분리로 GamePage가 한 청크 늦게 마운트되면서 * 그 창이 넓어져 실제로 재현됐다(점수 2건 + game.over가 같은 틱에 오면 결과가 안 뜬다). * <p> * 종료 뒤의 players는 현재 접속 명단이 아니라 결과 화면의 참가자 이름 원본이므로, * finished를 지킬 때는 명단도 함께 지킨다(RealtimeSync의 keepGameState와 같은 규칙).

### `src/room/components/QuickMatchOverlay.tsx`

- **if (result.status === 'MATCHED' && result.roomId && !roomSessionCreated) {**
  // 빠른 대전 백엔드가 이 사용자를 이미 방에 넣어 뒀다 — POST /rooms를 다시 부르면 안 된다. // 방 세션만 만들어 두면 대기실에서 기존 RealtimeSync가 room.join을 보낸다.

### `src/room/connectSequence.ts`

- **export const CONNECTED_VIBRATE_MS = 40**
  * 연결됐을 때의 진동 길이(ms). 폰은 주머니에 있거나 QR을 찍느라 아래를 보고 있어서 * 화면 변화만으로는 놓친다. iOS Safari는 `navigator.vibrate`가 없어 조용히 건너뛴다. * * ponytail: 사운드 피드백은 넣지 않았다 — 앱에 일회성 효과음 재생기가 없어서(있는 건 * 배경음악 `shared/audio/soundtrack`뿐) 이 한 곳을 위해 WebAudio 층을 새로 깔아야 한다. * 효과음이 다른 곳에도 필요해지면 그때 만들고 여기서 같이 울린다.

### `src/shared/audio/audioLevels.ts`

- **let levels: AudioLevels | null = null**
  재생마다 localStorage를 읽으면 안 된다(주사위 충돌음은 한 굴림에 여러 번 난다). 값은 메모리에 들고, 저장소는 세션 사이 복원에만 쓴다.

### `src/shared/audio/elementVolume.ts`

- **let context: AudioContext | null = null**
  * `<audio>` 요소의 볼륨을 정한다. iOS에서 `.volume` 대입이 무시되는 것을 감춘다. * * iOS Safari는 `HTMLMediaElement.volume`이 **읽기 전용**이다 — 대입해도 예외 없이 조용히 * 무시되고, 볼륨은 하드웨어 버튼만 바꾼다. 그래서 슬라이더를 0%로 내려도 소리가 원래 * 크기로 났고, 애초에 튜닝해 둔 기본 믹스(배경음 0.35 · 사발 0.5 · 쏟기 0.7)도 폰에서는 * 전부 100%로 뭉쳐 있었다. * * 우회로는 요소를 Web Audio로 흘려 GainNode로 줄이는 것뿐이다. 족보 음성(handVoice)이 이미 * 같은 방식으로 볼륨을 조절하고 폰에서 동작하는 것이 확인돼 있어, 그쪽에서 배운 것을 그대로 * 가져왔다 — `running`이 아니면 계속 깨우기, 제스처 리스너를 `once`로 떼지 않기. * * **기능 탐지("대입해 보고 읽어서 확인")를 하지 않는다.** 실기기에서 그 방법이 속는 것을 * 확인했다 — iOS는 대입을 무시하면서 값은 저장해서, 읽어 보면 넣은 값이 그대로 나온다. * 그래서 항상 Web Audio로 흘린다. UA도 보지 않는다. 대입이 먹는 브라우저에서도 GainNode는 * 똑같이 동작하므로 갈래를 둘 이유가 없다(코드도 줄어든다).
- **for (const type of ['pointerdown', 'touchend', 'keydown']) {**
  // once를 쓰지 않는다 — 한 번만 깨우면 다시 잠긴 뒤로 영영 무음이다(handVoice와 같은 이유).

### `src/shared/components/Icon.tsx`

- **function Dot({ cx, cy, r }: { cx: number; cy: number; r: number }) {**
  * 점은 stroke가 아니라 <b>칠한 원</b>으로 그린다. * * `d="M10 14h.01"`처럼 길이 0인 선분에 둥근 끝을 씌우는 흔한 수법은 점 지름이 곧 * `strokeWidth`(1.8/20)라, 16px에서 <b>1.4px</b>밖에 안 되어 사실상 사라진다(실측). * 반지름을 viewBox 기준으로 주면 크기와 함께 자란다.
- **export function IconWarning({ className }: IconProps) {**
  * 경고·주의. * * <b>삼각형 테두리를 함께 그린다.</b> 느낌표만 남기면 작은 크기에서 세로 막대 하나로 보여 * 「!」가 아니라 얼룩이나 `l`로 읽힌다(12~16px 실측). 삼각형은 글자가 뭉개지는 크기에서도 * <b>모양만으로</b> 경고를 말하고, 옆의 {@link IconCheck}와 실루엣으로 갈린다 — * `InAppBrowserGate`의 체크리스트가 두 아이콘을 같은 배지에 번갈아 넣는 자리다.

### `src/shared/components/Modal.tsx`

- **<motion.div**
  // alertdialog는 배경을 눌러 닫히면 안 된다 — 확인은 명시적 버튼으로만 받는다.

### `src/shared/vibrate.ts`

- **export function vibrate(pattern: VibratePattern) {**
  * 진동 한 줄 — 게임을 모르는 기기 출력이라 도메인이 아니라 shared 에 둔다. * * <b>진동은 언제나 보조 신호다.</b> iOS Safari에는 Vibration API 자체가 없어서 아이폰에서는 * 아무 일도 일어나지 않는다(폴리필도 없다 — 대체할 원본 API가 없다). 진동이 있어야만 * 알 수 있는 정보를 여기에 실으면 그 화면은 아이폰에서 깨진다. 소리·글씨가 먼저 말하고, * 진동은 그 위에 얹는 것까지만 한다. * * 탭이 숨어 있을 때 울리지 않는 이유: 게임은 서버 상태로 계속 흐르므로, 다른 앱을 보는 * 동안에도 이벤트는 도착한다. 보이지도 않는 화면 때문에 주머니 속 폰이 떨면 고장으로 읽힌다.

### `src/test/setup.ts`

- **vi.mock('motion/react', async (importOriginal) => {**
  AnimatePresence는 퇴장 애니메이션이 끝날 때까지 자식을 붙잡아 둔다. jsdom에서는 그 애니메이션이 시작조차 못 하므로 닫은 다이얼로그가 영영 DOM에 남는다 — "닫혔는가"를 검증할 수 없다. 테스트에서는 통과 컴포넌트로 바꿔 마운트·언마운트를 motion 도입 전과 같게 만든다. 진입·퇴장 연출 자체는 실기기·Playwright 시각 검토의 몫이다. motion.* 는 `initial={false}`를 강제해 처음부터 최종 상태로 그린다. skipAnimations로도 남는 틈이 하나 있기 때문이다 — motion은 `initial`을 DOM에 먼저 쓰고 **다음 태스크**에 최종 상태로 넘어간다(실측: 마운트 시 `opacity: 0`, macrotask 뒤 `opacity: 1`). `findByRole`은 요소가 생기는 순간 resolve되므로 그 사이에 `toBeVisible()`이 끼면 "열린 다이얼로그가 안 보인다"로 실패한다. 로컬에서는 대개 통과하고 부하가 걸린 CI에서 터지는 flake라, 단언을 하나씩 고치는 대신 틈 자체를 없앤다.

### `src/yacht/components/GamePlay/GamePlayBoard.tsx`

- **<ConnectionBanner status={connectionStatus} />**
  {/* closed면 조작이 전부 잠겼다는 유일한 시각 신호다 — 노치 아래로 들어가면 안 된다.
- **순간은 "남의 턴"인데 그때 푸터는 WaitingNotice가 차지한다.**
  {/* 리액션은 트레이 우하단에 띄운다 — 푸터에 끼우면 안 된다. 리액션을 가장 많이 쓰는

### `src/yacht/components/MotionPermissionPanel.tsx`

- **function CloseButton({ autoClose = false, onClose }: { autoClose?: boolean; onClose: () => void }) {**
  * 안내를 치우는 버튼. 이 패널은 주사위 화면 위를 덮으므로, * denied·error·insecure처럼 되돌릴 수 없는 상태에서 시야를 영구히 가리면 안 된다. * 모양·탭 크기는 Modal의 닫기 버튼과 맞춘다. * <p> * `autoClose`면 버튼을 두르는 링이 한 바퀴 도는 동안(3초) 남은 시간을 보여주고 스스로 * 닫는다 — 권한 안내는 되돌릴 수 있는 상태(버튼을 다시 누르면 또 뜬다)라 시야를 오래 * 가릴 이유가 없다. 링은 `conic-gradient` 각도만 움직이므로 레이아웃을 건드리지 않는다. * <p> * 자동 닫힘은 <b>motion-safe에서만</b> 돈다. 모션을 줄인 사용자에게 3초는 읽기에 짧을 수 * 있고, 시간 제한 자체가 WCAG 2.2.1의 대상이다 — 링이 멈추면 닫기도 멈춘다.

### `src/yacht/components/PhysicsDiceFallback.tsx`

- **label?: string**
  /** * 이 주사위 줄이 무엇인지. 3D 실패 대체 화면일 때가 기본값이지만, 파티 모드 컨트롤러는 * 이것을 <b>주 조작부</b>로 쓴다 — 거기서 "대체 화면"이라고 읽히면 안 된다.

### `src/yacht/components/ScoreSheet.tsx`

- **grow shrink-0 basis-auto: 남을 때만 늘고, 모자라면 줄지 않고 스크롤한다. */}**
  {/* 행 묶음만 남는 높이를 나눠 갖는다 — 헤더까지 함께 가운데로 밀리면 안 된다.

### `src/yacht/components/TutorialGuide/Backdrop.tsx`

- **export function Backdrop({ dim, spotlight }: { dim: boolean; spotlight: SpotlightRect | null }) {**
  * 각 단계에서 강조할 화면 조각. GamePlay가 붙여 둔 data-tutorial 표지를 찾는다 — * 좌표를 여기 적어 두면 레이아웃이 바뀔 때마다 조용히 어긋난다. * * 족보를 설명하는 동안에는 설명 중인 **그 칸**을 짚는다. 규칙만 읽어 주면 점수표에서 어느 * 칸인지는 여전히 모르므로, 이름과 자리를 같은 순간에 붙여 준다. * 강조한 곳만 빼고 화면을 덮는다. 눌러야 할 것 하나만 밝게 남으니 "여기"가 설명 없이 읽히고, * 덮인 자리는 클릭도 막혀 배우는 중에 엉뚱한 곳을 눌러 길을 잃지 않는다. * * 구멍 난 한 장이 아니라 네 장으로 둘러싸는 이유: box-shadow로 판 구멍은 그림자라 클릭을 * 막지 못하고, clip-path로 판 구멍은 가장자리가 계단처럼 깨진다. 네 장이면 구멍의 네 변이 * 정확히 맞고 각 장이 그대로 차단막이 된다. * * 누를 곳이 없는 단계(인사 · 마무리)는 통째로 덮어 읽는 데 집중시킨다.

### `src/yacht/components/TutorialGuide/GuideCard.tsx`

- **export function Card({**
  * 각 단계에서 강조할 화면 조각. GamePlay가 붙여 둔 data-tutorial 표지를 찾는다 — * 좌표를 여기 적어 두면 레이아웃이 바뀔 때마다 조용히 어긋난다. * * 족보를 설명하는 동안에는 설명 중인 **그 칸**을 짚는다. 규칙만 읽어 주면 점수표에서 어느 * 칸인지는 여전히 모르므로, 이름과 자리를 같은 순간에 붙여 준다. * 설명 카드. 강조한 곳을 가리면 안 되므로 구멍의 반대쪽 절반에 붙는다 — * 아래를 밝혔으면 위로, 위를 밝혔으면 아래로. * * 폭은 26rem에서 멈추고 가운데 선다. 딤과 차단막은 뷰포트를 덮어야 하므로 이 오버레이의 * 컨테이닝 블록은 뷰포트지만(구멍 좌표가 getBoundingClientRect 값이다), 카드는 **읽기 좋은 * 한 덩어리**여야 한다 — 게임 열(max-w-play, 넓은 화면에서 1536px)에 맞추면 한 줄에 글자가 * 100자 넘게 들어가 읽기 어렵고, 안의 버튼도 그만큼 멀어져 누르기 나쁘다. * mx-auto가 left/right 둘 다 잡힌 절대 요소를 상한 안에서 가운데로 되돌린다. * 모바일(375px)에서는 inset-x-4가 먼저 걸려 종전과 같은 343px이다.

### `src/yacht/components/TutorialGuide/lessons.tsx`

- **export function keepLesson(ctx: LessonContext, again: boolean): Lesson {**
  * 각 단계에서 강조할 화면 조각. GamePlay가 붙여 둔 data-tutorial 표지를 찾는다 — * 좌표를 여기 적어 두면 레이아웃이 바뀔 때마다 조용히 어긋난다. * * 족보를 설명하는 동안에는 설명 중인 **그 칸**을 짚는다. 규칙만 읽어 주면 점수표에서 어느 * 칸인지는 여전히 모르므로, 이름과 자리를 같은 순간에 붙여 준다. * 굴림 뒤 "남길 것을 고르는" 단계의 문구. 첫 선택과 두 번째 선택이 같은 판단을 하므로 한 * 곳에 둔다 — 두 번째는 이 고르기가 매 굴림마다 반복되는 규칙이라는 것을 덧붙인다.

### `src/yacht/components/TutorialGuide/openHandLessons.tsx`

- **const HAND_LESSONS: ReadonlyArray<{**
  * 각 단계에서 강조할 화면 조각. GamePlay가 붙여 둔 data-tutorial 표지를 찾는다 — * 좌표를 여기 적어 두면 레이아웃이 바뀔 때마다 조용히 어긋난다. * * 족보를 설명하는 동안에는 설명 중인 **그 칸**을 짚는다. 규칙만 읽어 주면 점수표에서 어느 * 칸인지는 여전히 모르므로, 이름과 자리를 같은 순간에 붙여 준다. * 족보 12칸을 **한 칸씩** 설명한다. 예전에는 "설명은 ? 도움말에 있어요"로 * 넘겼는데, 처음 온 사람에게 다른 곳을 찾아가라고 하면 대개 안 찾아간다 — 규칙을 알아야 * 어디에 적을지 고를 수 있으니 마스코트가 직접 말한다. * * 위 여섯 칸도 묶지 않고 하나씩 짚는다. "고른 숫자만 더해요" 한 줄로 묶으면 규칙은 맞지만 * 점수표에서 어느 칸이 무엇인지는 여전히 모른다 — 설명하는 칸을 화면에서 같이 강조하므로 * 칸과 이름이 여기서 처음 연결된다. * * 이름은 categoryLabel에서 가져온다. 여기 따로 적으면 점수표와 다르게 부르는 순간이 온다.

### `src/yacht/components/TutorialGuide/steps.ts`

- **interface PlaySignals {**
  * 각 단계에서 강조할 화면 조각. GamePlay가 붙여 둔 data-tutorial 표지를 찾는다 — * 좌표를 여기 적어 두면 레이아웃이 바뀔 때마다 조용히 어긋난다. * * 족보를 설명하는 동안에는 설명 중인 **그 칸**을 짚는다. 규칙만 읽어 주면 점수표에서 어느 * 칸인지는 여전히 모르므로, 이름과 자리를 같은 순간에 붙여 준다. 플레이 신호. 안내가 따로 세지 않고 GamePlay가 넘겨준 값에서만 읽는다.
- **if (step === 'done' || step === 'categories') return null**
  // 족보 설명과 마무리는 버튼으로만 넘어간다 — 읽는 중에 판이 바뀌어도 끌려가면 안 된다.

### `src/yacht/components/TutorialGuide.tsx`

- **/****
  * 각 단계에서 강조할 화면 조각. GamePlay가 붙여 둔 data-tutorial 표지를 찾는다 — * 좌표를 여기 적어 두면 레이아웃이 바뀔 때마다 조용히 어긋난다. * * 족보를 설명하는 동안에는 설명 중인 **그 칸**을 짚는다. 규칙만 읽어 주면 점수표에서 어느 * 칸인지는 여전히 모르므로, 이름과 자리를 같은 순간에 붙여 준다.

### `src/yacht/domain/localGame.ts`

- **'sys.ping': () => [],**
  // 로컬 판에는 하트비트를 받아 줄 서버가 없다. 조용히 삼킨다(strict면 던진다).

### `src/yacht/domain/reactions.ts`

- **export const DRIFTS = ['-3.2rem', '-2.4rem', '-1.5rem', '-0.7rem', '0rem']**
  * 항목마다 돌려 쓰는 좌우 흩뿌림. Math.random 대신 id로 고르면 테스트도 같은 그림을 본다. * <p> * <b>0 이하만 쓴다 — 독은 화면 오른쪽 끝에 붙어 있다.</b> 양수 drift는 이모지와 닉네임 필을 * 뷰포트 밖으로 밀어낸다(320px에서 실측: 필이 오른쪽에서 잘려 누가 보냈는지 못 읽었다). * 왼쪽은 트레이 안쪽이라 얼마든지 흩어져도 된다.

### `src/yacht/feedback/handVoice.ts`

- **export const HAND_VOICE_SOURCE: Record<SpecialHand, string> = {**
  * `public/audio/hand-voice/`의 콜아웃 음성. 화면에 뜨는 족보 텍스트와 같은 말을 읽는다. * 직접 녹음한 파일을 `scripts/voice-source/`에 넣고 `scripts/import-hand-voice.mjs`를 * 돌리면 이 경로에 만들어진다 — 목소리를 바꿔도 코드는 그대로다. * 파일이 없거나 재생이 막히면 조용히 넘어가고 콜아웃 텍스트만 남는다.
- **play(hand: SpecialHand): void**
  /** 족보 콜아웃이 화면에 뜨는 시점에 호출한다. 음소거·미지원이면 조용히 넘어간다.
- **export function createHandVoice({ muted = false }: { muted?: boolean } = {}): HandVoice {**
  * 족보 콜아웃 음성 재생기. * * `<audio>` 요소가 아니라 **Web Audio**로 재생한다. iOS Safari의 `<audio>`는 play()마다 * 플랫폼 미디어 파이프라인을 다시 세우고 seek 완료를 기다려서, 실기기에서 콜아웃 텍스트보다 * 목소리가 0.6~0.8초 늦게 나왔다(맥 Chrome에서는 안 보이는 증상). 미리 디코딩해 둔 * AudioBuffer를 start()로 트리거하면 그 지연이 사라진다. * * 굴림이 끝나는 시점은 사용자가 화면을 탭한 뒤 1초 이상 지난 뒤고, 흔들어 굴리면 탭이 아예 없다. * 두 경우 모두 자동재생 정책에 걸리므로, AudioContext는 만들어만 두고(suspended) 첫 제스처에서 * resume한다. 잠금을 풀지 못해도 게임은 그대로 진행된다 — 목소리는 콜아웃 텍스트를 보조하는 * 연출이고, 실패는 조용히 넘긴다.
- **context = null**
  // Web Audio를 못 쓰는 환경. play()가 조용히 넘어간다.
- **}**
  // 파일이 없거나 디코딩 실패. 그 족보만 조용히 텍스트로 넘어간다.
- **const gestureEvents = ['pointerdown', 'touchend', 'keydown'] as const**
  // once를 쓰지 않는다 — iOS는 전화·백그라운드 전환 뒤 context를 다시 재운다. 한 번만 듣고 // 떼면 그 뒤로는 영영 잠긴 채로 남는다. resume()을 다시 부르는 건 값이 싸다.

### `src/yacht/model/roll/useBroadcast.ts`

- **export function useRollBroadcast(roomId: string, roundNumber: number) {**
  * 내 굴림 동작을 같은 방에 알린다 — 킵, 흔들림, 던짐. * * 셋 다 <b>연출용 신호</b>다. 판정은 서버가 하고 그 결과는 broadcast로 따로 온다. 그래서 * 전송 실패를 여기서 되돌리지 않는다 — 연결 문제는 ConnectionBanner가 이미 말하고 있고, * 신호 하나를 놓쳤다고 게임이 멈추면 안 된다.

### `src/yacht/model/useGamePlayChrome.ts`

- **setSheetOpen(false)**
  // 남의 턴을 구경하며 열어둔 점수시트가 턴이 넘어간 뒤에도 남아있으면 안 된다(QA FND-5).
- **export function vibrateForMyTurn() {**
  짧은 두 번 진동. 미지원(iOS Safari 등)이면 조용히 넘어간다 — 토스트가 이미 알린다.
- **}**
  // 사용자 제스처 없이 호출하면 던지는 브라우저가 있다. 알림 실패가 게임을 막아선 안 된다.

### `src/yacht/model/useReactionDock.ts`

- **const known = REACTIONS.find((candidate) => candidate.type === reaction)**
  // 서버가 계약에 없는 reaction을 보낼 수 있다(FE보다 먼저 종류가 늘어난 경우). // 알 수 없는 값이면 말풍선으로 떨어뜨린다 — 리액션 하나 때문에 화면이 죽으면 안 된다.
- **}**
  // 소켓이 끊긴 동안의 리액션은 조용히 버린다 — 재전송할 가치가 없는 연출이고, // 연결이 끊겼다는 사실은 ConnectionBanner가 이미 말하고 있다.

### `src/yacht/model/useSpotlight.ts`

- **export function unionRect(targets: Element[]): SpotlightRect | null {**
  * 각 단계에서 강조할 화면 조각. GamePlay가 붙여 둔 data-tutorial 표지를 찾는다 — * 좌표를 여기 적어 두면 레이아웃이 바뀔 때마다 조용히 어긋난다. * * 족보를 설명하는 동안에는 설명 중인 **그 칸**을 짚는다. 규칙만 읽어 주면 점수표에서 어느 * 칸인지는 여전히 모르므로, 이름과 자리를 같은 순간에 붙여 준다. 여러 칸을 감싸는 하나의 사각형. 한 칸만 있으면 그 칸 그대로다.

### `src/yacht/rendering/physics-dice/config.ts`

- **0.8배(0.8² = 0.64)로 확정. 빨라진 체감은 뚜껑 사발의 격렬한 흔들림·높은 반발 튕김이**
  * 이 씬은 주사위 한 변 0.76유닛 = 실물 약 16mm이므로 축척이 실물의 약 47배다. 그래서 실제 * 중력에 대응하는 값은 9.81 × 47.5 ≈ 466이고, 원래 튜닝(중력 30)은 움직임 자체는 자연스러웠지만 * 1/15 슬로모션이었다 — 그게 "천천히 떨어진다"의 실체다. * * ## 낙하(비행)는 물리 닮음으로 빠르게 * * 중력만 올리면 안 된다. 낙하를 빠르게 하는 올바른 방법은 물리 닮음(dynamic similarity)을 * 지켜 "같은 움직임을 √k배 빠르게 재생"하는 것이다. 중력을 GRAVITY_SCALE배 하면 * SPEEDUP = √GRAVITY_SCALE 로: * * - 속도 · 각속도 · 임펄스        → × SPEEDUP * - 감쇠 계수(1/초) · 정착 임계 속도 → × SPEEDUP * - 시간 간격                    → ÷ SPEEDUP * - 거리 · 마찰 · 반발 계수(무차원)  → 그대로 * * 이 관계가 깨지면 궤적의 **모양**이 바뀐다. 중력만 12배 올리고 속도를 1.7배만 올렸을 때 * 비행 중 회전이 0.71 → 0.35바퀴로 반토막 나 "주사위가 안 구르고 처박힌다"가 됐다. * * ## 굴림은 3단계 — 뚜껑 덮인 사발 → 뒤집는 순간 던지기 → 자유 비행 * * 1. **흔들기**: 사발 콜라이더 위를 보이지 않는 뚜껑(lid)으로 막는다. 뚜껑이 있으니 흔들림 *    임펄스를 닮음 기준(×SPEEDUP)의 몇 배로 줘도 주사위가 튀어나오지 않고, 사발 안에서 *    격렬하게 튄다. 뚜껑 없이는 임펄스를 약하게 줄 수밖에 없어 주사위가 바닥에 붙어 보였다. * 2. **던지기(releaseTiltProgress)**: 사발이 기울기 시작하면 주사위에 측면 속도와 *    위쪽 속도, 회전 토크를 주고 사발 물리 바디를 치운다. * 3. **비행·착지**: 고정 스텝과 CCD로 관통을 막고, fan·randomZ로 퍼져 구른 뒤 안착한다. 재생 속도는 √GRAVITY_SCALE 배 — QA에서 12(3.5배)·6(2.4배)은 "배속 같다", 1도 급해 보여

### `src/yacht/rendering/physics-dice/World.ts`

- **setKeepAll(enabled: boolean) {**
  /** * 킵하지 않은 주사위까지 킵 레일에 함께 올릴지. 마지막 굴림이 시작되는 순간 켜고, 그 굴림의 * 정렬과 이후 idle 배치가 같은 규칙을 쓰게 한다 — 정렬 직후 다시 결과 줄로 내려가면 안 된다. * 굴리는 중(idle이 아닐 때)에는 값만 갈아두고, 진행 중인 애니메이션은 건드리지 않는다.
- **positionKeepSlots(**
  /* * 레일 바는 주사위가 가는 방향에 맞춰 움직인다. * * 떠나는 슬롯은 지금 끈다 — 주사위가 줄로 떠난 뒤 악센트 바만 남으면 안 된다. * 반대로 **채워지는** 슬롯은 켜지 않는다. keepAll이 켜지는 마지막 굴림에서는 남은 주사위가 * 아직 날아오는 중인데, 여기서 다섯 칸을 다 켜면 빈 레일에 테두리만 먼저 생기고 주사위가 * 나중에 도착한다. 도착한 뒤에 켜는 것은 updateResultAlignment의 마무리가 맡는다.

### `src/yacht/screens/GameDiceTray.tsx`

- **const [motionPanelOpen, setMotionPanelOpen] = useState(() => !coachOpen)**
  /* * 모션 안내는 켤 수 있는 상태가 되는 즉시 뜬다(QA 피드백). 닫으면 흔들기 칩으로 * 다시 연다 — 권한 안내는 3초 뒤 스스로 닫히므로 오래 막지 않는다. * * <b>단, 코치마크와 같은 순간에 뜨지는 않는다.</b> 두 안내가 겹치면 z-30인 이 패널이 * 코치마크(z-6)의 「알겠어요」를 덮어 <b>첫 진입 사용자가 코치마크를 닫을 수 없다</b> * (모션 안내 자동 열림과 튜토리얼 코치마크가 만나 생긴 자리다. 320px에서 실측·재현). * 코치마크를 닫는 순간 이어서 뜬다 — 둘 다 첫 진입 안내지만 한 번에 하나씩 읽힌다.

### `src/yacht/screens/GameResult.tsx`

- **if (session.membershipRole === 'dashboard') {**
  // 파티 모드 대시보드는 플레이어가 아니라 아래의 개인 결과(내 등수·내 점수)를 채울 값이 없다. // 순위 계산은 여기서 한 것을 그대로 넘긴다 — 두 화면이 다른 등수를 보이면 안 된다.

### `src/yacht/tutorialPreference.ts`

- **}**
  // 쿠키가 막힌 환경(임베디드 웹뷰 등)에서는 저장 실패가 게임을 막으면 안 된다.