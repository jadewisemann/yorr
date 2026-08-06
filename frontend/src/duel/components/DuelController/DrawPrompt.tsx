import { drawOutcome, msLabel } from '@/duel/domain/duel'
import type { DuelState } from '@/realtime/wsEvents'
import type { SwingPermission } from '@/shared/useSwing'

/**
 * 파티 모드 폰 화면 — 손 안의 리볼버. (S15P11A406-207)
 *
 * 결투는 큰 화면에서 벌어진다. 두 총잡이·총알·석양은 TV가 그리고, 폰은 <b>뽑는 일</b>만 한다.
 * 그래서 여기에 무대(Arena)를 축소해 넣지 않는다 — 같은 것을 두 화면에 그리면 폰을 보는
 * 동안 TV의 연출을 놓치고, 세로 그립에 억지로 접어 넣은 무대는 둘 다 못 읽는 화면이 된다.
 *
 * 대신 아래를 <b>보지 않고도</b> 알아야 하는 것만 남긴다: 신호가 초록인가, 내 탄약이 몇 발
 * 남았나, 경고가 몇 개 쌓였나. 판정은 서버가 하고 이 화면은 상태를 읽기만 한다.
 */

/** 신호등이 지금 무슨 색인가 — 폰이 아는 것은 이 넷뿐이다. */
export type ControllerSignal = 'hold' | 'draw' | 'result' | 'waiting'

export function signalOf(state: DuelState, playerId: string): ControllerSignal {
  if (state.phase === 'RESULT' || state.phase === 'FINISHED') return 'result'
  // 한 라운드에 한 발이다. 이미 뽑았으면 초록이라도 더 할 일이 없다.
  if (state.phase === 'SIGNAL') return state.reactions[playerId] === undefined ? 'draw' : 'waiting'
  return 'hold'
}

export function holdHint(permission: SwingPermission): string {
  return permission === 'granted' ? '초록이 되면 폰을 휘둘러라' : '초록이 되면 화면을 눌러라'
}

export function Prompt({
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

/** 지금 무엇을 해야 하는가 — 신호 아래 한 줄. */
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
