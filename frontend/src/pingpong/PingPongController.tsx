import { useCallback, useEffect, useRef, useState } from 'react'
import type { PingPongState, RoomSnapshot } from '@/realtime/wsEvents'
import type { SwingPermission } from '@/shared/useSwing'
import { useSwing } from '@/shared/useSwing'
import { comboStyle, feedbackTextClass, playerEventLabel } from './feedback'

interface PingPongControllerProps {
  clock: number
  error: string | null
  nickname: string
  onLeave: () => void
  onSwing: () => void
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
    swingActive: Boolean(ownEvent && eventAge < 260),
  }
}

export function PingPongController({
  clock,
  error,
  nickname,
  onLeave,
  onSwing,
  permission,
  playerId,
  requestPermission,
  snapshot,
  state,
}: PingPongControllerProps) {
  const view = controllerView(state, snapshot, playerId, clock)

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
        <ControllerScore label="나" score={state.scores[playerId] ?? 0} tone="blue" />
        <div className="text-center">
          <span className="block font-mono text-[11px] tracking-[0.14em] text-white/40">RALLY</span>
          <strong className="font-mono text-2xl">{state.rally}</strong>
        </div>
        <ControllerScore
          label={view.opponentName}
          score={state.scores[view.opponentId] ?? 0}
          tone="red"
        />
      </section>

      <ControllerArena onSwing={onSwing} rally={state.rally} view={view} />

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
        <button
          className="min-h-12 rounded-2xl border border-white/18 bg-white/8 px-5 font-bold active:scale-[0.98] active:bg-white/15"
          onClick={onSwing}
          type="button"
        >
          화면을 눌러 스윙
        </button>
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
  onSwing,
  rally,
  view,
}: {
  onSwing: () => void
  rally: number
  view: ControllerView
}) {
  const paddlePose = view.swingActive ? 'rotate-[-28deg] scale-110' : 'rotate-[-8deg]'
  return (
    <button
      aria-label="탁구채를 휘두르기"
      className="relative mt-4 min-h-0 flex-1 overflow-hidden rounded-[2rem] border border-white/12 bg-[radial-gradient(circle_at_50%_45%,rgb(43_143_224_/_22%),transparent_58%)] active:bg-white/8"
      onPointerDown={onSwing}
      type="button"
    >
      <span
        aria-hidden="true"
        className={`absolute top-[18%] left-1/2 block h-[42%] aspect-square -translate-x-1/2 rounded-full border-[10px] border-[#e2513c]/45 bg-[#e2513c] shadow-[0_18px_45px_rgb(226_81_60_/_35%)] transition-transform duration-150 ${paddlePose}`}
      />
      <span
        aria-hidden="true"
        className={`absolute top-[53%] left-1/2 h-[28%] w-10 origin-top -translate-x-1/2 rounded-b-full bg-[#201a1a] transition-transform duration-150 ${paddlePose}`}
      />
      <ControllerPrompt countdown={view.countdown} incoming={view.incoming} />
      <ControllerEvent view={view} />
      {rally > 0 && <ComboBadge count={rally} />}
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

function ControllerEvent({ view }: { view: ControllerView }) {
  if (!view.label || !view.event || view.eventAge >= 900) return null
  return (
    <span
      className={`animate-pp-feedback-pop absolute inset-x-0 top-[10%] text-center text-3xl font-black drop-shadow-xl ${feedbackTextClass(view.event.type)}`}
    >
      {view.label}
    </span>
  )
}

export function PingPongControllerSetup() {
  const [practiceCount, setPracticeCount] = useState(0)
  const [flash, setFlash] = useState(false)
  const flashTimer = useRef<number | null>(null)
  const practice = useCallback(() => {
    setPracticeCount((count) => count + 1)
    setFlash(true)
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlash(false), 180)
  }, [])
  const { permission, requestPermission } = useSwing({ enabled: true, onSwing: practice })

  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    },
    [],
  )

  return (
    <section
      aria-label="탁구 컨트롤러 연습"
      className="grid flex-none grid-cols-[5.25rem_minmax(0,1fr)] items-center gap-3 rounded-panel border border-[#2b8fe0]/35 bg-[#2b8fe0]/8 p-3"
    >
      <button
        aria-label="연습 스윙"
        className={`relative grid size-[5.25rem] place-items-center rounded-2xl border border-[#e2513c]/45 bg-black/20 transition-transform ${flash ? 'scale-110 rotate-[-8deg]' : ''}`}
        onClick={practice}
        type="button"
      >
        <span aria-hidden="true" className="text-5xl">
          🏓
        </span>
      </button>
      <div className="grid min-w-0 gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <strong className="text-sm">시작 전에 스윙해 보세요</strong>
          <span className="font-mono text-xs text-[#73bfff]">{practiceCount}회 감지</span>
        </div>
        <p className="m-0 text-xs leading-relaxed text-content-muted">
          폰을 탁구채처럼 휘두르거나 왼쪽 연습 버튼을 눌러보세요. 연습 입력은 점수에 반영되지
          않아요.
        </p>
        {permission === 'unknown' ? (
          <button
            className="min-h-9 justify-self-start rounded-full border border-[#49e08a]/40 bg-[#49e08a]/12 px-3 text-xs font-bold text-[#8dffc0]"
            onClick={() => void requestPermission()}
            type="button"
          >
            모션 센서 테스트
          </button>
        ) : (
          <span className="text-xs text-[#49e08a]">
            {permission === 'granted' ? '모션 센서 준비 완료' : '화면 탭으로도 플레이할 수 있어요'}
          </span>
        )}
      </div>
    </section>
  )
}

export function ComboBadge({ count }: { count: number }) {
  const tier = comboStyle(count)
  return (
    <span
      className="animate-pp-combo-hit pointer-events-none absolute top-[23%] left-1/2 z-10 -translate-x-1/2 text-center leading-none"
      style={{ color: tier.color, textShadow: tier.glow }}
    >
      <span className={`${tier.size} font-black tabular-nums`}>{count}</span>
      <span className="ml-1 align-super text-sm font-black tracking-widest">COMBO</span>
    </span>
  )
}

function ControllerScore({
  label,
  score,
  tone,
}: {
  label: string
  score: number
  tone: 'blue' | 'red'
}) {
  return (
    <div className={tone === 'blue' ? 'text-[#73bfff]' : 'text-[#ff8b7c]'}>
      <span className="block max-w-24 truncate text-xs font-bold text-white/55">{label}</span>
      <strong className="font-mono text-3xl leading-none">{score}</strong>
    </div>
  )
}
