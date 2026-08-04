import type { PingPongEventType } from '@/realtime/wsEvents'

const EVENT_LABELS: Partial<
  Record<PingPongEventType, readonly [mine: string | null, opponent: string | null]>
> = {
  // 이모지는 아이콘이 아니라 카피 속 장식이다 — 나머지 라벨에는 없어 형제와 맞지 않는다.
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
  if (type === 'SMASH') return 'text-[#ff7a4d]'
  if (type === 'NICE') return 'text-[#ffd24a]'
  if (type === 'TOO_EARLY' || type === 'TOO_LATE' || type === 'OUT' || type === 'NET') {
    return 'text-[#ff8b7c]'
  }
  return 'text-white'
}

export function comboStyle(count: number) {
  if (count >= 8) return { color: '#ff7a4d', size: 'text-7xl', glow: '0 0 24px #ff7a4d99' }
  if (count >= 5) return { color: '#ffd24a', size: 'text-6xl', glow: '0 0 20px #ffd24a8c' }
  if (count >= 3) return { color: '#49e08a', size: 'text-5xl', glow: '0 0 16px #49e08a80' }
  return { color: '#ffffff', size: 'text-5xl', glow: '0 2px 10px #00000080' }
}
