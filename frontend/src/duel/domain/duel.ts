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
