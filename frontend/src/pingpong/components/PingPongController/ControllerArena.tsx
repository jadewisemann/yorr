import { ComboBadge } from '@/pingpong/components/ComboBadge'
import type { ControllerView, PaddleTone } from '@/pingpong/components/PingPongController/types'
import { feedbackTextClass } from '@/pingpong/feedback'

export function paddleFaceClass(tone: PaddleTone) {
  return tone === 'blue'
    ? 'border-pp-side-blue/45 bg-pp-side-blue shadow-[0_18px_45px_rgb(43_143_224_/_35%)]'
    : 'border-pp-danger/45 bg-pp-danger shadow-[0_18px_45px_rgb(226_81_60_/_35%)]'
}

function ControllerPrompt({ countdown, incoming }: { countdown: number; incoming: boolean }) {
  if (countdown > 0) {
    return (
      <span className="absolute inset-0 grid place-items-center bg-scrim-soft font-mono text-8xl font-black backdrop-blur-[2px]">
        {countdown}
      </span>
    )
  }
  return (
    <span className="absolute inset-x-5 bottom-7 text-center text-base font-bold text-game-content">
      {incoming ? '지금 공이 오고 있어요 · 타이밍에 맞춰 스윙!' : '상대의 리턴을 기다리세요'}
    </span>
  )
}

function ControllerFeedback({ rally, view }: { rally: number; view: ControllerView }) {
  const showEvent = Boolean(view.label && view.event && view.eventAge < 900)
  const label = showEvent ? view.label : view.situationLabel
  const tone = showEvent && view.event ? feedbackTextClass(view.event.type) : 'text-pp-gold'
  return (
    <span className="pointer-events-none absolute inset-x-0 top-[7%] z-10 grid justify-items-center gap-2 text-center">
      <span className={`min-h-9 text-3xl font-black drop-shadow-xl ${tone}`}>
        {label && <span className="animate-pp-feedback-pop">{label}</span>}
      </span>
      {rally > 0 && <ComboBadge count={rally} />}
    </span>
  )
}

export function ControllerArena({
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
      className="relative mt-4 min-h-0 flex-1 overflow-hidden rounded-hero border border-border bg-[radial-gradient(circle_at_50%_45%,rgb(43_143_224_/_22%),transparent_58%)] active:bg-surface-veil"
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
        className={`absolute top-[53%] left-1/2 h-[28%] w-10 origin-top -translate-x-1/2 rounded-b-full bg-pp-paddle-grip transition-transform duration-150 ${paddlePose}`}
      />
      <ControllerPrompt countdown={view.countdown} incoming={view.incoming} />
      <ControllerFeedback rally={rally} view={view} />
    </button>
  )
}
