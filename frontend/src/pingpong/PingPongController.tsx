import type { PingPongState, RoomSnapshot } from '@/realtime/wsEvents'
import type { SwingPermission } from '@/shared/useSwing'
import {
  comboStyle,
  feedbackTextClass,
  pingPongSituation,
  playerEventLabel,
  playerSituationLabel,
} from './feedback'

interface PingPongControllerProps {
  clock: number
  error: string | null
  nickname: string
  onLeave: () => void
  onReady: () => void
  onTouchSwing: () => void
  permission: SwingPermission
  playerId: string
  requestPermission: () => Promise<void>
  snapshot: RoomSnapshot
  state: PingPongState
}

interface ControllerView {
  countdown: number
  event: PingPongState['lastEvent']
  eventAge: number
  incoming: boolean
  label: string | null
  opponentId: string
  opponentName: string
  situationLabel: string | null
  swingActive: boolean
}

function controllerView(
  state: PingPongState,
  snapshot: RoomSnapshot,
  playerId: string,
  clock: number,
): ControllerView {
  const me = state.playerOrder.indexOf(playerId)
  const opponentId = state.playerOrder[me === 0 ? 1 : 0] ?? ''
  const opponent = snapshot.players.find((player) => player.playerId === opponentId)
  const event = state.lastEvent
  const eventAge = event ? clock - event.at : Number.POSITIVE_INFINITY
  const ownEvent = event?.playerId === playerId
  const playerIndex = me === 1 ? 1 : 0
  const situation =
    state.phase === 'COUNTDOWN'
      ? pingPongSituation(
          state.scores[state.playerOrder[0] ?? ''] ?? 0,
          state.scores[state.playerOrder[1] ?? ''] ?? 0,
        )
      : null
  return {
    countdown:
      state.phase === 'COUNTDOWN'
        ? Math.max(1, Math.ceil((state.nextActionAt - clock) / 1_000))
        : 0,
    event,
    eventAge,
    incoming: me === 0 ? state.ball.direction > 0 : state.ball.direction < 0,
    label: event ? playerEventLabel(event.type, ownEvent) : null,
    opponentId,
    opponentName: opponent?.nickname ?? '상대',
    situationLabel: playerSituationLabel(situation, playerIndex),
    swingActive: Boolean(ownEvent && eventAge < 260),
  }
}

export function PingPongController({
  clock,
  error,
  nickname,
  onLeave,
  onReady,
  onTouchSwing,
  permission,
  playerId,
  requestPermission,
  snapshot,
  state,
}: PingPongControllerProps) {
  const view = controllerView(state, snapshot, playerId, clock)
  const paddleTone: PaddleTone = state.playerOrder.indexOf(playerId) === 1 ? 'red' : 'blue'
  const [p1, p2] = playerSlots(state, playerId, view.opponentName)

  if (state.phase === 'PREPARING') {
    return (
      <PingPongPreparationController
        error={error}
        nickname={nickname}
        onLeave={onLeave}
        onReady={onReady}
        onTouchSwing={onTouchSwing}
        permission={permission}
        paddleTone={paddleTone}
        playerId={playerId}
        readyPlayerIds={state.readyPlayerIds}
        requestPermission={requestPermission}
        state={state}
        view={view}
      />
    )
  }

  return (
    <main className="relative flex h-svh w-full touch-none select-none flex-col overflow-hidden bg-[#070b12] px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] text-white">
      <header className="flex flex-none items-center justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <span className="font-mono text-[11px] tracking-[0.18em] text-white/40">
            PHONE CONTROLLER
          </span>
          <strong className="truncate text-lg">{nickname}</strong>
        </div>
        <button
          className="min-h-11 rounded-full border border-white/15 bg-white/6 px-4 text-sm text-white/70"
          onClick={onLeave}
          type="button"
        >
          나가기
        </button>
      </header>

      <section className="mt-4 flex flex-none items-center justify-between rounded-2xl border border-white/12 bg-white/6 px-4 py-3">
        <ControllerScore
          label={p1.label}
          score={state.scores[p1.id] ?? 0}
          tag={p1.tag}
          tone={p1.tone}
        />
        <div className="text-center">
          <span className="block font-mono text-[11px] tracking-[0.14em] text-white/40">RALLY</span>
          <strong className="font-mono text-2xl">{state.rally}</strong>
        </div>
        <ControllerScore
          label={p2.label}
          score={state.scores[p2.id] ?? 0}
          tag={p2.tag}
          tone={p2.tone}
        />
      </section>

      <ControllerArena
        onTouchSwing={usesTouchFallback(permission) ? onTouchSwing : undefined}
        paddleTone={paddleTone}
        rally={state.rally}
        view={view}
      />

      <section className="mt-3 grid flex-none gap-2 text-center">
        {permission === 'unknown' && (
          <button
            className="min-h-12 rounded-2xl border border-[#49e08a]/45 bg-[#49e08a]/12 px-5 font-bold text-[#8dffc0]"
            onClick={() => void requestPermission()}
            type="button"
          >
            폰 스윙 켜기
          </button>
        )}
        {permission === 'granted' && (
          <p className="m-0 text-sm font-bold text-[#8dffc0]" role="status">
            모션 스윙 연결됨 · 휴대폰을 휘둘러 주세요
          </p>
        )}
        {usesTouchFallback(permission) && (
          <button
            className="min-h-12 rounded-2xl border border-white/18 bg-white/8 px-5 font-bold active:scale-[0.98] active:bg-white/15"
            onClick={onTouchSwing}
            type="button"
          >
            화면을 눌러 스윙 · 대체 조작
          </button>
        )}
        {error && (
          <p className="m-0 text-sm text-red-300" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  )
}

function ControllerArena({
  onTouchSwing,
  paddleTone,
  rally,
  view,
}: {
  onTouchSwing?: (() => void) | undefined
  paddleTone: PaddleTone
  rally: number
  view: ControllerView
}) {
  const paddlePose = view.swingActive ? 'rotate-[-28deg] scale-110' : 'rotate-[-8deg]'
  const paddleFace = paddleFaceClass(paddleTone)
  return (
    <button
      aria-label={onTouchSwing ? '탁구채를 눌러 스윙' : '휴대폰을 휘둘러 스윙'}
      aria-disabled={!onTouchSwing}
      className="relative mt-4 min-h-0 flex-1 overflow-hidden rounded-[2rem] border border-white/12 bg-[radial-gradient(circle_at_50%_45%,rgb(43_143_224_/_22%),transparent_58%)] active:bg-white/8"
      onClick={onTouchSwing}
      type="button"
    >
      <span
        aria-hidden="true"
        className={`absolute top-[18%] left-1/2 block h-[42%] aspect-square -translate-x-1/2 rounded-full border-[10px] transition-transform duration-150 ${paddleFace} ${paddlePose}`}
        data-player-tone={paddleTone}
        data-testid="ping-pong-paddle-face"
      />
      <span
        aria-hidden="true"
        className={`absolute top-[53%] left-1/2 h-[28%] w-10 origin-top -translate-x-1/2 rounded-b-full bg-[#201a1a] transition-transform duration-150 ${paddlePose}`}
      />
      <ControllerPrompt countdown={view.countdown} incoming={view.incoming} />
      <ControllerFeedback rally={rally} view={view} />
    </button>
  )
}

function ControllerPrompt({ countdown, incoming }: { countdown: number; incoming: boolean }) {
  if (countdown > 0) {
    return (
      <span className="absolute inset-0 grid place-items-center bg-black/35 font-mono text-8xl font-black backdrop-blur-[2px]">
        {countdown}
      </span>
    )
  }
  return (
    <span className="absolute inset-x-5 bottom-7 text-center text-base font-bold text-white/75">
      {incoming ? '지금 공이 오고 있어요 · 타이밍에 맞춰 스윙!' : '상대의 리턴을 기다리세요'}
    </span>
  )
}

function ControllerFeedback({ rally, view }: { rally: number; view: ControllerView }) {
  const showEvent = Boolean(view.label && view.event && view.eventAge < 900)
  const label = showEvent ? view.label : view.situationLabel
  const tone = showEvent && view.event ? feedbackTextClass(view.event.type) : 'text-[#ffd24a]'
  return (
    <span className="pointer-events-none absolute inset-x-0 top-[7%] z-10 grid justify-items-center gap-2 text-center">
      <span className={`min-h-9 text-3xl font-black drop-shadow-xl ${tone}`}>
        {label && <span className="animate-pp-feedback-pop">{label}</span>}
      </span>
      {rally > 0 && <ComboBadge count={rally} />}
    </span>
  )
}

function PingPongPreparationController({
  error,
  nickname,
  onLeave,
  onReady,
  onTouchSwing,
  paddleTone,
  permission,
  playerId,
  readyPlayerIds,
  requestPermission,
  state,
  view,
}: {
  error: string | null
  nickname: string
  onLeave: () => void
  onReady: () => void
  onTouchSwing: () => void
  paddleTone: PaddleTone
  permission: SwingPermission
  playerId: string
  readyPlayerIds: string[]
  requestPermission: () => Promise<void>
  state: PingPongState
  view: ControllerView
}) {
  const practiced = (state.lastInputSeq[playerId] ?? -1) >= 0
  const ready = readyPlayerIds.includes(playerId)
  const practiceAck =
    view.event?.type === 'PRACTICE' && view.event.playerId === playerId && view.eventAge < 1_200
  const practiceAction = selectPracticeAction(permission, requestPermission, onTouchSwing)
  const paddleFace = paddleFaceClass(paddleTone)
  const [p1, p2] = playerSlots(state, playerId, view.opponentName)

  return (
    <main className="relative flex h-svh w-full touch-none select-none flex-col overflow-hidden bg-[#070b12] px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] text-white">
      <header className="flex flex-none items-center justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <span className="font-mono text-[11px] tracking-[0.18em] text-[#73bfff]">WARM-UP</span>
          <strong className="truncate text-lg">{nickname}</strong>
        </div>
        <button
          className="min-h-11 rounded-full border border-white/15 bg-white/6 px-4 text-sm text-white/70"
          onClick={onLeave}
          type="button"
        >
          나가기
        </button>
      </header>

      <section className="mt-4 grid flex-none grid-cols-2 gap-2" aria-label="참가자 준비 상태">
        <PreparationStatus label={p1.label} ready={readyPlayerIds.includes(p1.id)} tag={p1.tag} />
        <PreparationStatus label={p2.label} ready={readyPlayerIds.includes(p2.id)} tag={p2.tag} />
      </section>

      <div className="mt-5 text-center">
        <h1 className="m-0 text-2xl font-black">연습 공을 쳐보세요</h1>
        {/* 잡는 법이 여기 있는 이유: 빠른 대전으로 들어온 폰은 대기실 사용법
            (`PingPongControllerHowTo`)을 지나지 않는다 — 매칭이 잡히면 대기 백드롭이 걷히기
            전에 경기가 시작돼서, 이 화면이 그 사람이 보는 첫 안내다(S15P11A406-206). */}
        <p className="mt-1.5 mb-0 text-sm text-white/55">
          {usesTouchFallback(permission)
            ? '화면을 눌러 받아치세요. '
            : '폰을 라켓처럼 세워 쥐고 팔로 짧게 휘두르세요. '}
          스윙이 감지된 뒤 준비 완료를 누르면 두 사람이 함께 시작해요.
        </p>
      </div>

      <button
        aria-label="연습 공 치기"
        aria-disabled={permission === 'granted'}
        className="relative mt-4 min-h-0 flex-1 overflow-hidden rounded-[2rem] border border-[#2b8fe0]/35 bg-[radial-gradient(circle_at_50%_42%,rgb(43_143_224_/_24%),transparent_60%)] active:bg-white/8"
        onClick={practiceAction}
        type="button"
      >
        <span
          aria-hidden="true"
          className={`absolute top-[18%] left-1/2 size-14 -translate-x-1/2 rounded-full bg-white shadow-[0_0_28px_rgb(255_255_255_/_55%)] ${practiceAck ? 'animate-pp-practice-ball' : ''}`}
        />
        <span
          aria-hidden="true"
          className={`absolute top-[46%] left-1/2 block h-[34%] aspect-square -translate-x-1/2 rounded-full border-[9px] transition-transform duration-150 ${paddleFace} ${practiceAck ? 'rotate-[-28deg] scale-110' : 'rotate-[-8deg]'}`}
          data-player-tone={paddleTone}
          data-testid="ping-pong-paddle-face"
        />
        <span
          className={`absolute inset-x-4 bottom-5 text-center text-base font-black ${practiced ? 'text-[#49e08a]' : 'text-white/70'}`}
        >
          {practiceAck ? '스윙 감지 완료! 공을 맞혔어요' : practicePrompt(permission)}
        </span>
      </button>

      <section className="mt-3 grid flex-none gap-2">
        {permission === 'unknown' && (
          <button
            className="min-h-12 rounded-2xl border border-[#49e08a]/45 bg-[#49e08a]/12 px-5 font-bold text-[#8dffc0]"
            onClick={() => void requestPermission()}
            type="button"
          >
            폰 스윙 켜기
          </button>
        )}
        <PreparationMotionStatus permission={permission} practiced={practiced} />
        <button
          className="min-h-14 rounded-2xl bg-[#e2513c] px-5 text-lg font-black text-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35"
          disabled={!practiced || ready}
          onClick={onReady}
          type="button"
        >
          {readyButtonLabel(practiced, ready)}
        </button>
        {error && (
          <p className="m-0 text-center text-sm text-red-300" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  )
}

/** 센서 대신 화면 탭으로 스윙하는 기기인가. 대기실 사용법(`PingPongControllerHowTo`)도 같은 선을 쓴다. */
export function usesTouchFallback(permission: SwingPermission) {
  return permission === 'denied' || permission === 'unsupported'
}

function selectPracticeAction(
  permission: SwingPermission,
  requestPermission: () => Promise<void>,
  onTouchSwing: () => void,
): (() => void) | undefined {
  if (permission === 'unknown') return () => void requestPermission()
  return usesTouchFallback(permission) ? onTouchSwing : undefined
}

function practicePrompt(permission: SwingPermission) {
  if (permission === 'unknown') return '화면을 눌러 모션 센서 연결'
  if (permission === 'granted') return '센서 연결 완료 · 휴대폰을 휘둘러 스윙'
  return '화면을 눌러 스윙 · 센서 대체 조작'
}

/**
 * 워밍업 준비 완료 버튼의 문구. 폰 컨트롤러와 데스크톱 코트가 같은 세 상태를 말한다 —
 * 한쪽만 고치면 같은 조건에서 두 기기가 다른 말을 한다.
 */
export function readyButtonLabel(practiced: boolean, ready: boolean) {
  if (ready) return '준비 완료 · 친구를 기다리는 중'
  return practiced ? '준비 완료' : '먼저 공을 한 번 쳐보세요'
}

function PreparationMotionStatus({
  permission,
  practiced,
}: {
  permission: SwingPermission
  practiced: boolean
}) {
  if (practiced || permission === 'unknown') return null
  if (permission === 'granted') {
    return (
      <p className="m-0 text-center text-sm font-bold text-[#8dffc0]" role="status">
        센서 연결 완료 · 휴대폰을 실제로 휘둘러 주세요
      </p>
    )
  }
  return (
    <p className="m-0 text-center text-sm text-amber-200" role="status">
      모션 센서를 사용할 수 없어 화면 터치 대체 조작을 사용합니다.
    </p>
  )
}

function PreparationStatus({ label, ready, tag }: { label: string; ready: boolean; tag: string }) {
  return (
    <div
      className={`rounded-2xl border px-3 py-2.5 text-center text-sm font-bold ${ready ? 'border-[#49e08a]/45 bg-[#49e08a]/12 text-[#8dffc0]' : 'border-white/12 bg-white/6 text-white/45'}`}
    >
      <span className="flex items-center justify-center gap-1">
        <span className="rounded border border-current px-1 font-mono text-[10px] font-black leading-none">
          {tag}
        </span>
        <span className="truncate">{label}</span>
      </span>
      <span className="mt-0.5 block text-xs">{ready ? '준비 완료' : '연습 중'}</span>
    </div>
  )
}

export function ComboBadge({ count }: { count: number }) {
  const tier = comboStyle(count)
  return (
    <span
      className="animate-pp-combo-hit pointer-events-none text-center leading-none"
      style={{ color: tier.color, textShadow: tier.glow }}
    >
      <span className={`${tier.size} font-black tabular-nums`}>{count}</span>
      <span className="ml-1 align-super text-sm font-black tracking-widest">COMBO</span>
    </span>
  )
}

type PaddleTone = 'blue' | 'red'

function paddleFaceClass(tone: PaddleTone) {
  return tone === 'blue'
    ? 'border-[#2b8fe0]/45 bg-[#2b8fe0] shadow-[0_18px_45px_rgb(43_143_224_/_35%)]'
    : 'border-[#e2513c]/45 bg-[#e2513c] shadow-[0_18px_45px_rgb(226_81_60_/_35%)]'
}

interface PlayerSlot {
  id: string
  label: string
  tag: 'P1' | 'P2'
  tone: PaddleTone
}

/** 대시보드·코트와 같은 P1(왼쪽·파랑)·P2(오른쪽·빨강) 순서로 두 슬롯을 만든다. */
function playerSlots(
  state: PingPongState,
  playerId: string,
  opponentName: string,
): [PlayerSlot, PlayerSlot] {
  const slot = (index: 0 | 1, tag: 'P1' | 'P2', tone: PaddleTone): PlayerSlot => {
    const id = state.playerOrder[index] ?? ''
    return { id, label: playerId === id ? '나' : opponentName, tag, tone }
  }
  return [slot(0, 'P1', 'blue'), slot(1, 'P2', 'red')]
}

function ControllerScore({
  label,
  score,
  tag,
  tone,
}: {
  label: string
  score: number
  tag: string
  tone: 'blue' | 'red'
}) {
  return (
    <div className={tone === 'blue' ? 'text-[#73bfff]' : 'text-[#ff8b7c]'}>
      <span className="flex max-w-24 items-center gap-1 text-xs font-bold text-white/55">
        <span className="rounded border border-current px-1 font-mono text-[10px] font-black leading-none">
          {tag}
        </span>
        <span className="truncate">{label}</span>
      </span>
      <strong className="font-mono text-3xl leading-none">{score}</strong>
    </div>
  )
}
