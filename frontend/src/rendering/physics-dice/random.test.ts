import { describe, expect, it } from 'vitest'
import { createPhysicsDiceRandom } from './random'

describe('createPhysicsDiceRandom', () => {
  it('같은 seed에서 같은 연출 난수열을 만든다', () => {
    const first = createPhysicsDiceRandom(73)
    const second = createPhysicsDiceRandom(73)

    expect(Array.from({ length: 20 }, () => first.next())).toEqual(
      Array.from({ length: 20 }, () => second.next()),
    )
  })

  it('0 이상 1 미만의 값을 반환한다', () => {
    const random = createPhysicsDiceRandom(18)
    const values = Array.from({ length: 100 }, () => random.next())

    expect(values.every((value) => value >= 0 && value < 1)).toBe(true)
  })

  it('유한하지 않은 seed를 거부한다', () => {
    expect(() => createPhysicsDiceRandom(Number.NaN)).toThrow(RangeError)
  })
})
