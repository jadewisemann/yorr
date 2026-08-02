import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { PHYSICS_DICE_CONFIG } from './config'
import { faceNormalForValue, topFaceFromQuaternion } from './model'
import {
  cubeAlignmentOffset,
  type DiceTrajectoryPlan,
  diceTrajectoryIssueScore,
  type PredictableDie,
  planDiceTrajectory,
  predictNaturalDice,
} from './remap'
import { containDiceInTray } from './safety'
import type { PhysicsDiceValue } from './types'

const CONFIG = PHYSICS_DICE_CONFIG
const ROLLING_HALF =
  CONFIG.defaults.diceSize * CONFIG.scene.colliderHalfRatio * CONFIG.scene.bowlDiceScale
const ROLLING_WIDTH = ROLLING_HALF * 2

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
        RAPIER.ColliderDesc.cuboid(ROLLING_HALF, ROLLING_HALF, ROLLING_HALF)
          .setMass(CONFIG.defaults.mass)
          .setFriction(CONFIG.defaults.friction)
          .setRestitution(CONFIG.defaults.restitution),
        body,
      )
      body.setLinvel({ x: -1.5 + index, y: 0.5, z: 0.8 }, true)
      body.setAngvel({ x: 7 - index * 3, y: 5, z: -6 + index * 2 }, true)
      return { body, enteredTray: false, index: index as PredictableDie['index'] }
    })
    const held = [false, false, false, true, true] as const

    const trajectory = planDiceTrajectory(world, entries, held)
    const predicted = predictNaturalDice(world, entries, held)

    expect(trajectory).not.toBeNull()
    expect(predicted).not.toBeNull()
    expect(trajectory?.naturalDice).toEqual(predicted)
    const finalFrame = trajectory?.frames.at(-1)
    if (!trajectory || !finalFrame) throw new Error('trajectory plan is missing')
    const target = [6, 5, 4] as const
    finalFrame.poses.slice(0, 3).forEach((pose, slot) => {
      const targetValue = target[slot]
      const naturalValue = trajectory.naturalDice[slot]
      if (!targetValue || !naturalValue) throw new Error('trajectory die is missing')
      const visual = new THREE.Quaternion(
        pose.rotation.x,
        pose.rotation.y,
        pose.rotation.z,
        pose.rotation.w,
      ).multiply(cubeAlignmentOffset(targetValue, naturalValue))
      expect(topFaceFromQuaternion(visual)).toBe(targetValue)
    })
    for (let step = 0; step < 60 * 20; step += 1) {
      world.step()
      containDiceInTray(entries)
    }
    entries.forEach((entry, slot) => {
      expect(topFaceFromQuaternion(entry.body.rotation())).toBe(predicted?.[slot])
    })
    world.free()
  })

  it('예측 결과가 스택이면 결정론적 분산을 적용한 후보를 선택한다', async () => {
    await RAPIER.init()
    const world = new RAPIER.World({ x: 0, y: -19.2, z: 0 })
    world.timestep = 1 / 480
    world.createCollider(RAPIER.ColliderDesc.cuboid(4, 0.1, 4).setTranslation(0, -0.1, 0))
    const halfSize = ROLLING_HALF
    const entries: PredictableDie[] = [0, 1].map((index) => {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(0, halfSize * (1 + index * 2), 0),
      )
      world.createCollider(RAPIER.ColliderDesc.cuboid(halfSize, halfSize, halfSize), body)
      return { body, enteredTray: true, index: index as PredictableDie['index'] }
    })
    for (let step = 0; step < 480; step += 1) world.step()
    const held = [false, false, true, true, true] as const

    const stackedPlan: DiceTrajectoryPlan = {
      attempt: 0,
      durationSeconds: 0,
      floorAssists: 0,
      frames: [
        {
          atSeconds: 0,
          poses: entries.map(({ body }) => ({
            position: { ...body.translation() },
            rotation: { ...body.rotation() },
          })),
        },
      ],
      naturalDice: [1, 2, 3, 4, 5],
      settled: true,
    }
    const trajectory = planDiceTrajectory(world, entries, held, 142)
    const repeated = planDiceTrajectory(world, entries, held, 142)

    expect(diceTrajectoryIssueScore(stackedPlan, entries, held)).toBeGreaterThan(0)
    expect(trajectory).not.toBeNull()
    expect(trajectory?.attempt).toBeGreaterThan(0)
    expect(trajectory?.attempt).toBeLessThan(3)
    expect(trajectory?.attempt).toBe(repeated?.attempt)
    expect(trajectory?.frames.at(-1)).toEqual(repeated?.frames.at(-1))
    if (trajectory) {
      expect(diceTrajectoryIssueScore(trajectory, entries, held)).toBeLessThan(
        diceTrajectoryIssueScore(stackedPlan, entries, held),
      )
    }
    world.free()
  })

  it('바닥에 모서리로 멈춘 주사위만 눌러 다시 정착시킨다', async () => {
    await RAPIER.init()
    const world = new RAPIER.World({ x: 0, y: -19.2, z: 0 })
    world.timestep = 1 / 480
    world.createCollider(RAPIER.ColliderDesc.cuboid(4, 0.1, 4).setTranslation(0, -0.1, 0))
    const halfSize = ROLLING_HALF
    const angle = Math.PI / 4
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, halfSize * Math.SQRT2, 0)
        .setRotation({
          x: 0,
          y: 0,
          z: Math.sin(angle / 2),
          w: Math.cos(angle / 2),
        }),
    )
    world.createCollider(RAPIER.ColliderDesc.cuboid(halfSize, halfSize, halfSize), body)
    body.sleep()
    const entries: PredictableDie[] = [{ body, enteredTray: true, index: 0 }]
    const held = [false, true, true, true, true] as const

    const trajectory = planDiceTrajectory(world, entries, held, 142)

    expect(trajectory?.floorAssists).toBeGreaterThan(0)
    expect(trajectory?.settled).toBe(true)
    expect(trajectory?.frames.at(-1)?.poses[0]?.position.y).toBeLessThan(halfSize * 1.25)
    world.free()
  })
})

describe('diceStackScore', () => {
  const entries = [0, 1].map(
    (index) =>
      ({
        enteredTray: true,
        index,
      }) as PredictableDie,
  )
  const plan = (secondPosition: { x: number; y: number; z: number }): DiceTrajectoryPlan => ({
    attempt: 0,
    durationSeconds: 1,
    floorAssists: 0,
    frames: [
      {
        atSeconds: 1,
        poses: [
          {
            position: { x: 0, y: ROLLING_HALF, z: 0 },
            rotation: { w: 1, x: 0, y: 0, z: 0 },
          },
          {
            position: secondPosition,
            rotation: { w: 1, x: 0, y: 0, z: 0 },
          },
        ],
      },
    ],
    naturalDice: [1, 2, 3, 4, 5],
    settled: true,
  })

  it('수평으로 가까우면서 높이 차가 나는 주사위만 스택으로 판정한다', () => {
    const held = [false, false, true, true, true] as const

    expect(
      diceTrajectoryIssueScore(
        plan({ x: 0.05, y: ROLLING_HALF + ROLLING_WIDTH, z: 0.05 }),
        entries,
        held,
      ),
    ).toBeGreaterThan(0)
    expect(
      diceTrajectoryIssueScore(
        plan({ x: ROLLING_WIDTH * 1.3, y: ROLLING_HALF + ROLLING_WIDTH, z: 0 }),
        entries,
        held,
      ),
    ).toBeGreaterThan(0)
    expect(
      diceTrajectoryIssueScore(plan({ x: 0.05, y: ROLLING_HALF, z: 0.05 }), entries, held),
    ).toBeGreaterThan(0)
    expect(
      diceTrajectoryIssueScore(
        plan({ x: ROLLING_WIDTH * 1.3, y: ROLLING_HALF, z: 0 }),
        entries,
        held,
      ),
    ).toBe(0)
  })

  it('킵된 주사위는 스택 판정에서 제외한다', () => {
    const held = [false, true, true, true, true] as const

    expect(
      diceTrajectoryIssueScore(
        plan({ x: 0.05, y: ROLLING_HALF + ROLLING_WIDTH, z: 0.05 }),
        entries,
        held,
      ),
    ).toBe(0)
  })

  it('제한시간까지 정착하지 않은 궤적에는 우선순위가 낮아지는 벌점을 준다', () => {
    const unsettled = {
      ...plan({ x: ROLLING_WIDTH * 1.3, y: ROLLING_HALF, z: 0 }),
      settled: false,
    }

    expect(
      diceTrajectoryIssueScore(unsettled, entries, [false, false, true, true, true]),
    ).toBeGreaterThanOrEqual(1_000)
  })
})
