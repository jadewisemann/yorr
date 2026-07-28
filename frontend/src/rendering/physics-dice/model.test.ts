import { describe, expect, it } from 'vitest'
import { quaternionForTopValue, topFaceFromQuaternion } from './model'
import type { PhysicsDiceValue } from './types'

describe('physics dice face orientation', () => {
  it.each([1, 2, 3, 4, 5, 6] as const)('%i 목표 quaternion의 윗면을 보장한다', (value) => {
    expect(topFaceFromQuaternion(quaternionForTopValue(value))).toBe(value)
  })

  it('Rapier가 반환하는 plain quaternion도 판정한다', () => {
    const quaternion = quaternionForTopValue(5 as PhysicsDiceValue)

    expect(
      topFaceFromQuaternion({
        x: quaternion.x,
        y: quaternion.y,
        z: quaternion.z,
        w: quaternion.w,
      }),
    ).toBe(5)
  })
})
