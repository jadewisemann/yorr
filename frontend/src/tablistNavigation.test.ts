import { describe, expect, it } from 'vitest'
import { resolveTablistKey } from './tablistNavigation'

describe('resolveTablistKey', () => {
  it('moves forward with both orientations', () => {
    expect(resolveTablistKey('ArrowDown', 0, 5)).toBe(1)
    expect(resolveTablistKey('ArrowRight', 0, 5)).toBe(1)
  })

  it('moves backward with both orientations', () => {
    expect(resolveTablistKey('ArrowUp', 3, 5)).toBe(2)
    expect(resolveTablistKey('ArrowLeft', 3, 5)).toBe(2)
  })

  it('wraps around at both ends', () => {
    expect(resolveTablistKey('ArrowRight', 4, 5)).toBe(0)
    expect(resolveTablistKey('ArrowLeft', 0, 5)).toBe(4)
  })

  it('jumps to the first and last tab', () => {
    expect(resolveTablistKey('Home', 3, 5)).toBe(0)
    expect(resolveTablistKey('End', 1, 5)).toBe(4)
  })

  it('leaves every other key to the browser', () => {
    expect(resolveTablistKey('Enter', 1, 5)).toBeNull()
    expect(resolveTablistKey('Tab', 1, 5)).toBeNull()
    expect(resolveTablistKey('a', 1, 5)).toBeNull()
  })
})
