import { DUEL_FOUL, type DuelState } from '@/realtime/wsEvents'

export type ShotTarget = 'opponent' | 'ground'

export type DuelInputSource = 'key' | 'swing' | 'tap'

export const DRAW_PENALTY_MS: Record<DuelInputSource, number> = {
  key: 100,
  swing: 0,
  tap: 100,
}

export function drawPenaltyMs(reactionMs: number, source: DuelInputSource): number {
  return isClean(reactionMs) ? DRAW_PENALTY_MS[source] : 0
}

export const MAX_HP = 3
export const MAX_FOULS = 2

export const SWING_THRESHOLD = 15

export const BULLET_TRACK_INSET = 0.24

const BULLET_SPEED_PX_MS = 1.6
const MIN_FLIGHT_MS = 260
const MAX_FLIGHT_MS = 420

export function flightMs(stageWidth: number): number {
  const distance = Math.max(0, stageWidth) * (1 - BULLET_TRACK_INSET * 2)
  const raw = distance / BULLET_SPEED_PX_MS
  return Math.round(Math.min(MAX_FLIGHT_MS, Math.max(MIN_FLIGHT_MS, raw)))
}

export function impactDelayMs(flight: number, flownMs: number): number {
  return Math.max(0, Math.round(flight - flownMs))
}

export type DuelOutcome = 'draw' | 'lost' | 'won'

export function duelOutcome({
  fallenId,
  myHp,
  opponentHp,
  you,
}: {
  fallenId: string | null | undefined
  myHp: number
  opponentHp: number
  you: string
}): DuelOutcome {
  if (fallenId) return fallenId === you ? 'lost' : 'won'
  if (myHp === opponentHp) return 'draw'
  return myHp > opponentHp ? 'won' : 'lost'
}

const MISS_TAUNTS = [
  '눈 감고 쐈나?',
  '손이 떨렸군',
  '모자만 스쳤다',
  '바람이 도와줬어',
  '탄약이 아깝군',
  '조금 더 자고 왔어야지',
  '거기서 쏘면 맞겠나',
  '그걸로 날 잡겠다고?',
  '느려',
  '어딜 보고 쏘는 거야',
  '늙은이',
  '애송이',
  '되겠냐',
  '풉',
  '쉽다',
  '귀엽네',
] as const

export function missTaunt(seed: number): string {
  return MISS_TAUNTS[Math.abs(Math.trunc(seed)) % MISS_TAUNTS.length] ?? MISS_TAUNTS[0]
}

export function isClean(ms: number | null | undefined): ms is number {
  return typeof ms === 'number' && ms >= 0
}

export function slots(name: string, total: number, filled: number) {
  return Array.from({ length: total }, (_, index) => ({
    filled: index < filled,
    id: `${name}-${index}`,
  }))
}

export function drawOutcome(
  state: DuelState,
  you: string,
): { label: string; tone: 'lose' | 'warn' | 'win' } {
  const round = state.lastRound
  if (!round) return { label: '대기', tone: 'warn' }
  const mine = round.foulId === you
  switch (round.kind) {
    case 'FORFEIT':
      return { label: '상대가 떠났다', tone: 'win' }
    case 'SELF_SHOT':
      return mine
        ? { label: '자기 발을 쐈다', tone: 'lose' }
        : { label: '상대가 자기 발을 쐈다', tone: 'win' }
    case 'TIE':
      return { label: '동시에 뽑았다', tone: 'warn' }
    case 'WARNING':
      return mine ? { label: '성급했다', tone: 'warn' } : { label: '상대가 성급했다', tone: 'warn' }
    default:
      return round.shooterId === you
        ? { label: '명중!', tone: 'win' }
        : { label: '맞았다', tone: 'lose' }
  }
}

export function msLabel(ms: number | null | undefined): string {
  if (ms === DUEL_FOUL) return '성급했다'
  if (!isClean(ms)) return '얼어붙음'
  return `${ms}ms`
}

/**
 * 뽑기 한 번의 판정 — 이른 출발인가, 신호로부터 몇 ms인가, 보낼 값은 얼마인가.
 *
 * 왜 여기 있나: 이 세 값은 **규칙**이고(부정출발은 값을 치르는 선택이 아니라 하면 안
 * 되는 일이다), 훅 안에 있으면 시계·타이머와 뒤섞여 테스트할 수 없다. 화면이 아니라
 * 규칙이므로 `domain/`이 제자리다.
 */
export interface DrawDecision {
  /** 신호 전에 눌렀는가 — 서버도 이 값을 부정출발로 판정한다. */
  readonly early: boolean
  /** 서버로 보낼 반응 시간(부정출발이면 `DUEL_FOUL`). */
  readonly reactionMs: number
  /** 이번 뽑기가 지는 페널티(ms). 붙는 순간 발사가 늦어진다. */
  readonly penaltyMs: number
  /** 총알이 향하는 곳 — 부정출발은 자기 발밑이다. */
  readonly target: 'ground' | 'opponent'
}

/**
 * @param phase 현재 판의 단계. `WAITING`이면 아직 신호가 아니다.
 * @param signalSeenAt 신호를 본 로컬 시각(신호 전이면 null).
 * @param now 지금 시각(`performance.now()`).
 */
export function decideDraw(
  phase: DuelState['phase'],
  signalSeenAt: number | null,
  now: number,
  source: DuelInputSource,
): DrawDecision {
  const early = phase === 'WAITING' || signalSeenAt === null
  const reactionMs = early ? DUEL_FOUL : Math.round(now - signalSeenAt)
  return {
    early,
    reactionMs,
    penaltyMs: drawPenaltyMs(reactionMs, source),
    target: early ? 'ground' : 'opponent',
  }
}
