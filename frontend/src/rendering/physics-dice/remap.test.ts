import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { faceNormalForValue, topFaceFromQuaternion } from './model'
import { cubeAlignmentOffset, type PredictableDie, predictNaturalDice } from './remap'
import { containDiceInTray } from './safety'
import type { PhysicsDiceValue } from './types'

const ALL_VALUES: PhysicsDiceValue[] = [1, 2, 3, 4, 5, 6]
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]

describe('cubeAlignmentOffset', () => {
  it('모든 (목표, 자연) 조합에서 목표면 법선을 자연면 법선으로 보낸다', () => {
    ALL_VALUES.forEach((target) => {
      ALL_VALUES.forEach((natural) => {
        const offset = cubeAlignmentOffset(target, natural)
        const mapped = faceNormalForValue(target).applyQuaternion(offset)

        expect(mapped.distanceTo(faceNormalForValue(natural))).toBeLessThan(1e-6)
      })
    })
  })

  it('오프셋은 항상 큐브 대칭 회전이다 — 좌표축이 좌표축으로 간다', () => {
    ALL_VALUES.forEach((target) => {
      ALL_VALUES.forEach((natural) => {
        const offset = cubeAlignmentOffset(target, natural)
        AXES.forEach((axis) => {
          const mapped = axis.clone().applyQuaternion(offset)
          const snapped = mapped
            .clone()
            .set(Math.round(mapped.x), Math.round(mapped.y), Math.round(mapped.z))

          expect(mapped.distanceTo(snapped)).toBeLessThan(1e-6)
          expect(Math.abs(snapped.length() - 1)).toBeLessThan(1e-6)
        })
      })
    })
  })

  it('바디 회전에 오프셋을 합성하면 표시 윗면이 목표값이 된다', () => {
    ALL_VALUES.forEach((target) => {
      ALL_VALUES.forEach((natural) => {
        // 자연면이 위를 향하는 임의의 바디 자세 하나를 만든다 (정렬 후 y축 yaw).
        const bodyRotation = new THREE.Quaternion()
          .setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7)
          .multiply(
            new THREE.Quaternion().setFromUnitVectors(
              faceNormalForValue(natural),
              new THREE.Vector3(0, 1, 0),
            ),
          )
        expect(topFaceFromQuaternion(bodyRotation)).toBe(natural)

        const visual = bodyRotation.clone().multiply(cubeAlignmentOffset(target, natural))

        expect(topFaceFromQuaternion(visual)).toBe(target)
      })
    })
  })
})

describe('predictNaturalDice', () => {
  it('복제 시뮬 예측이 같은 월드의 실제 진행 결과와 일치한다', async () => {
    await RAPIER.init()
    const world = new RAPIER.World({ x: 0, y: -18, z: 0 })
    world.timestep = 1 / 60
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(4, 0.1, 4).setTranslation(0, -0.1, 0).setFriction(0.74),
    )
    const entries: PredictableDie[] = [0, 1, 2].map((index) => {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(index - 1, 1.6 + index * 0.3, 0)
          .setLinearDamping(0.16)
          .setAngularDamping(0.2),
      )
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.27, 0.27, 0.27)
          .setMass(1.15)
          .setFriction(0.74)
          .setRestitution(0.34),
        body,
      )
      body.setLinvel({ x: -1.5 + index, y: 0.5, z: 0.8 }, true)
      body.setAngvel({ x: 7 - index * 3, y: 5, z: -6 + index * 2 }, true)
      return { body, enteredTray: false, index: index as PredictableDie['index'] }
    })
    const held = [false, false, false, true, true] as const

    const predicted = predictNaturalDice(world, entries, held)

    expect(predicted).not.toBeNull()
    for (let step = 0; step < 60 * 20; step += 1) {
      world.step()
      containDiceInTray(entries)
    }
    entries.forEach((entry, slot) => {
      expect(topFaceFromQuaternion(entry.body.rotation())).toBe(predicted?.[slot])
    })
    world.free()
  })
})
