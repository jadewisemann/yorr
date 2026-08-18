import type { PingPongEventType } from '@/realtime/wsEvents'

export type PingPongSituation =
  | { leader: 0 | 1; type: 'MATCH_POINT' }
  | { leader: null; type: 'DEUCE' }

const EVENT_LABELS: Partial<
  Record<PingPongEventType, readonly [mine: string | null, opponent: string | null]>
> = {
  SMASH: ['스매시!', '상대 스매시!'],
  NICE: ['나이스!', '상대가 받아쳤어요'],
  OK: ['굿!', '리턴!'],
  TOO_EARLY: ['너무 빨라요', null],
  TOO_LATE: ['너무 늦었어요', null],
  OUT: ['아웃!', '상대 아웃!'],
  NET: ['네트!', '상대 네트!'],
  POINT: ['득점!', '실점'],
  OPPONENT_LEFT: ['상대가 나갔어요', '상대가 나갔어요'],
}

export function playerEventLabel(type: PingPongEventType, mine: boolean) {
  return EVENT_LABELS[type]?.[mine ? 0 : 1] ?? null
}

export function sharedEventLabel(type: PingPongEventType, actorName: string) {
  switch (type) {
    case 'SMASH':
      return `${actorName} 스매시!`
    case 'NICE':
      return `${actorName} 나이스!`
    case 'OK':
      return `${actorName} 리턴!`
    case 'TOO_EARLY':
      return `${actorName} 너무 빨라요`
    case 'TOO_LATE':
      return `${actorName} 너무 늦었어요`
    case 'OUT':
      return `${actorName} 아웃!`
    case 'NET':
      return `${actorName} 네트!`
    case 'POINT':
      return `${actorName} 득점!`
    case 'OPPONENT_LEFT':
      return '상대가 나갔어요'
    default:
      return null
  }
}

export function feedbackTextClass(type: PingPongEventType) {
  if (type === 'SMASH') return 'text-pp-smash'
  if (type === 'NICE') return 'text-pp-gold'
  if (type === 'TOO_EARLY' || type === 'TOO_LATE' || type === 'OUT' || type === 'NET') {
    return 'text-pp-danger-text'
  }
  return 'text-content'
}

const glow = (token: string, blur: string, alpha: number) =>
  `0 0 ${blur} color-mix(in srgb, var(${token}) ${alpha}%, transparent)`

export function comboStyle(count: number) {
  if (count >= 8)
    return {
      color: 'var(--ds-pp-smash)',
      size: 'text-7xl',
      glow: glow('--ds-pp-smash', '24px', 60),
    }
  if (count >= 5)
    return { color: 'var(--ds-pp-gold)', size: 'text-6xl', glow: glow('--ds-pp-gold', '20px', 55) }
  if (count >= 3)
    return {
      color: 'var(--ds-pp-accent)',
      size: 'text-5xl',
      glow: glow('--ds-pp-accent', '16px', 50),
    }
  return { color: '#ffffff', size: 'text-5xl', glow: '0 2px 10px #00000080' }
}

export function pingPongSituation(
  firstScore: number,
  secondScore: number,
): PingPongSituation | null {
  if (firstScore >= 10 && firstScore === secondScore) return { leader: null, type: 'DEUCE' }
  if (firstScore >= 10 && firstScore > secondScore) return { leader: 0, type: 'MATCH_POINT' }
  if (secondScore >= 10 && secondScore > firstScore) return { leader: 1, type: 'MATCH_POINT' }
  return null
}

export function playerSituationLabel(situation: PingPongSituation | null, player: 0 | 1) {
  if (!situation) return null
  if (situation.type === 'DEUCE') return '듀스!'
  return situation.leader === player ? '매치 포인트!' : '상대 매치 포인트'
}

export function sharedSituationLabel(
  situation: PingPongSituation | null,
  firstName: string,
  secondName: string,
) {
  if (!situation) return null
  if (situation.type === 'DEUCE') return '듀스!'
  return `${situation.leader === 0 ? firstName : secondName} 매치 포인트!`
}
