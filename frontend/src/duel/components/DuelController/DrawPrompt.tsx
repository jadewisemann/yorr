import { drawOutcome, msLabel } from '@/duel/domain/duel'
import type { DuelState } from '@/realtime/wsEvents'
import type { SwingPermission } from '@/shared/useSwing'

export type ControllerSignal = 'hold' | 'draw' | 'result' | 'waiting'

export function signalOf(state: DuelState, playerId: string): ControllerSignal {
  if (state.phase === 'RESULT' || state.phase === 'FINISHED') return 'result'
  if (state.phase === 'SIGNAL') return state.reactions[playerId] === undefined ? 'draw' : 'waiting'
  return 'hold'
}

function holdHint(permission: SwingPermission): string {
  return permission === 'granted' ? '초록이 되면 폰을 휘둘러라' : '초록이 되면 화면을 눌러라'
}

function Prompt({
  children,
  sub,
  tone,
}: {
  children: string
  sub: string | undefined
  tone: string
}) {
  return (
    <span className="absolute inset-x-4 bottom-[12%] grid justify-items-center gap-1.5 text-center">
      <strong className={`text-4xl font-black ${tone}`}>{children}</strong>
      {sub && <span className="text-sm text-game-content-faint">{sub}</span>}
    </span>
  )
}

export function DrawPrompt({
  ms,
  opponentName,
  permission,
  signal,
  state,
  you,
}: {
  ms: number | null
  opponentName: string
  permission: SwingPermission
  signal: ControllerSignal
  state: DuelState
  you: string
}) {
  if (signal === 'result') {
    const outcome = drawOutcome(state, you)
    const tone =
      outcome.tone === 'win'
        ? 'text-duel-positive'
        : outcome.tone === 'lose'
          ? 'text-duel-danger'
          : ''
    return (
      <Prompt sub={undefined} tone={tone}>
        {outcome.label}
      </Prompt>
    )
  }
  if (signal === 'waiting') {
    return (
      <Prompt sub={`${opponentName}를 기다린다`} tone="text-duel-accent">
        {msLabel(ms)}
      </Prompt>
    )
  }
  if (signal === 'draw') {
    return (
      <Prompt tone="text-duel-positive" sub={undefined}>
        뽑아!
      </Prompt>
    )
  }
  return (
    <Prompt sub={holdHint(permission)} tone="text-game-content-faint">
      기다려
    </Prompt>
  )
}
