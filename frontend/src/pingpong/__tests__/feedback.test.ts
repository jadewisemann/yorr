import { describe, expect, it } from 'vitest'
import { comboStyle, playerEventLabel, sharedEventLabel } from '../feedback'

describe('ping pong feedback', () => {
  it('labels server events for a player and the shared party display', () => {
    expect(playerEventLabel('SMASH', true)).toBe('스매시! 💥')
    expect(playerEventLabel('TOO_EARLY', true)).toBe('너무 빨라요')
    expect(sharedEventLabel('TOO_LATE', '유정')).toBe('유정 너무 늦었어요')
    expect(sharedEventLabel('SMASH', '정현')).toBe('정현 스매시! 💥')
  })

  it('raises the combo tier as the rally continues', () => {
    expect(comboStyle(1).color).toBe('#ffffff')
    expect(comboStyle(3).color).toBe('#49e08a')
    expect(comboStyle(5).color).toBe('#ffd24a')
    expect(comboStyle(8).color).toBe('#ff7a4d')
  })
})
