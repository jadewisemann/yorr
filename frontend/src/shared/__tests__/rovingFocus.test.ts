import { describe, expect, it } from 'vitest'
import { resolveRovingKey } from '@/shared/rovingFocus'

describe('resolveRovingKey', () => {
  it('moves forward with both orientations', () => {
    expect(resolveRovingKey('ArrowDown', 0, 5)).toBe(1)
    expect(resolveRovingKey('ArrowRight', 0, 5)).toBe(1)
  })

  it('moves backward with both orientations', () => {
    expect(resolveRovingKey('ArrowUp', 3, 5)).toBe(2)
    expect(resolveRovingKey('ArrowLeft', 3, 5)).toBe(2)
  })

  it('wraps around at both ends', () => {
    expect(resolveRovingKey('ArrowRight', 4, 5)).toBe(0)
    expect(resolveRovingKey('ArrowLeft', 0, 5)).toBe(4)
  })

  it('jumps to the first and last tab', () => {
    expect(resolveRovingKey('Home', 3, 5)).toBe(0)
    expect(resolveRovingKey('End', 1, 5)).toBe(4)
  })

  it('leaves every other key to the browser', () => {
    expect(resolveRovingKey('Enter', 1, 5)).toBeNull()
    expect(resolveRovingKey('Tab', 1, 5)).toBeNull()
    expect(resolveRovingKey('a', 1, 5)).toBeNull()
  })
})
