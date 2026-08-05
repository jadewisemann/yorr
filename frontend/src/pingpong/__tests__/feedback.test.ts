import { describe, expect, it } from 'vitest'
import {
  comboStyle,
  pingPongSituation,
  playerEventLabel,
  playerSituationLabel,
  sharedEventLabel,
  sharedSituationLabel,
} from '../feedback'

describe('ping pong feedback', () => {
  it('labels server events for a player and the shared party display', () => {
    // 이모지는 카피 속 장식이라 걷었다 — 나머지 라벨에는 없다(S15P11A406-186 B-2).
    expect(playerEventLabel('SMASH', true)).toBe('스매시!')
    expect(playerEventLabel('TOO_EARLY', true)).toBe('너무 빨라요')
    expect(sharedEventLabel('TOO_LATE', '유정')).toBe('유정 너무 늦었어요')
    expect(sharedEventLabel('SMASH', '정현')).toBe('정현 스매시!')
  })

  it('raises the combo tier as the rally continues', () => {
    expect(comboStyle(1).color).toBe('#ffffff')
    expect(comboStyle(3).color).toBe('var(--ds-pp-accent)')
    expect(comboStyle(5).color).toBe('var(--ds-pp-gold)')
    expect(comboStyle(8).color).toBe('var(--ds-pp-smash)')
  })

  it('labels deuce and match point from the authoritative score', () => {
    const deuce = pingPongSituation(10, 10)
    expect(playerSituationLabel(deuce, 0)).toBe('듀스!')
    expect(sharedSituationLabel(deuce, '유정', '정현')).toBe('듀스!')

    const firstMatchPoint = pingPongSituation(10, 8)
    expect(playerSituationLabel(firstMatchPoint, 0)).toBe('매치 포인트!')
    expect(playerSituationLabel(firstMatchPoint, 1)).toBe('상대 매치 포인트')
    expect(sharedSituationLabel(firstMatchPoint, '유정', '정현')).toBe('유정 매치 포인트!')

    expect(pingPongSituation(9, 9)).toBeNull()
  })
})
