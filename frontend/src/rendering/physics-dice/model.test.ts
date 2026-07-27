import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { closestQuaternionForTopValue, quaternionForTopValue, topFaceFromQuaternion } from './model'
import type { PhysicsDiceValue } from './types'

describe('physics dice face orientation', () => {
  it.each([1, 2, 3, 4, 5, 6] as const)('%i 목표 quaternion의 윗면을 보장한다', (value) => {
    expect(topFaceFromQuaternion(quaternionForTopValue(value))).toBe(value)
  })

  it.each([1, 2, 3, 4, 5, 6] as const)(
    '%i 눈을 유지하면서 현재 자세와 가장 가까운 수평 회전을 선택한다',
    (value) => {
      const current = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
        .multiply(quaternionForTopValue(value))
      const closest = closestQuaternionForTopValue(value, current)

      expect(topFaceFromQuaternion(closest)).toBe(value)
      expect(Math.abs(current.dot(closest))).toBeCloseTo(1, 6)
    },
  )

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
