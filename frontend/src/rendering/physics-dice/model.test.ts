import { describe, expect, it } from 'vitest'
import { faceNormalForValue, quaternionForTopValue, topFaceFromQuaternion } from './model'
import type { PhysicsDiceValue } from './types'

describe('physics dice face orientation', () => {
  it.each([1, 2, 3, 4, 5, 6] as const)('%i 목표 quaternion의 윗면을 보장한다', (value) => {
    expect(topFaceFromQuaternion(quaternionForTopValue(value))).toBe(value)
  })

  it.each([
    [1, 6],
    [2, 5],
    [3, 4],
  ] as const)('마주보는 눈 %i·%i의 법선은 서로 반대 방향이다(정규 주사위 합=7)', (a, b) => {
    const normalA = faceNormalForValue(a)
    const normalB = faceNormalForValue(b)
    expect(normalA.clone().add(normalB).length()).toBeCloseTo(0)
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
