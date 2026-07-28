import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { PHYSICS_DICE_CONFIG } from './config'
import { faceNormalForValue, topFaceFromQuaternion } from './model'
import { containDiceInTray, type TrayOccupant } from './safety'
import type { PhysicsDiceIndex, PhysicsDiceSet, PhysicsDiceValue, PhysicsHeldDice } from './types'

const SETTLEMENT = PHYSICS_DICE_CONFIG.scene.settlement
const MAX_PREDICTION_SECONDS = 20
const STABLE_STEPS = 20

/**
 * 목표면 법선을 자연 결과면 법선으로 보내는 큐브 대칭 회전.
 * `mesh.quaternion = body.rotation × offset`으로 쓰면 물리가 자연면으로 멈출 때
 * 화면에는 목표값이 위를 향한다. 축 정렬 법선 간이라 90° 또는 180° 회전이다.
 */
export function cubeAlignmentOffset(
  target: PhysicsDiceValue,
  natural: PhysicsDiceValue,
): THREE.Quaternion {
  const targetNormal = faceNormalForValue(target)
  const naturalNormal = faceNormalForValue(natural)
  const dot = targetNormal.dot(naturalNormal)
  if (dot > 0.5) return new THREE.Quaternion()
  if (dot < -0.5) {
    const axis =
      Math.abs(targetNormal.x) > 0.5 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
    return new THREE.Quaternion().setFromAxisAngle(axis, Math.PI)
  }
  return new THREE.Quaternion().setFromUnitVectors(targetNormal, naturalNormal)
}

/**
 * 현재 월드를 스냅샷 복제해 렌더링 없이 완주시키고 각 주사위의 자연 결과면을 읽는다.
 * 쏟아짐 직후(이후 난수 소비·외부 개입이 없는 시점)에 호출해야 실제 진행과 일치한다.
 * 정착 실패·복제 실패 시 null — 호출부는 오프셋 없이 정렬 안전망에 맡긴다.
 */
/** DieEntry의 부분 shape — 예측에 필요한 최소 단위. */
export interface PredictableDie {
  body: RAPIER.RigidBody
  enteredTray: boolean
  index: PhysicsDiceIndex
}

export function predictNaturalDice(
  world: RAPIER.World,
  entries: PredictableDie[],
  held: PhysicsHeldDice,
): PhysicsDiceSet | null {
  let clone: RAPIER.World | null = null
  try {
    clone = RAPIER.World.restoreSnapshot(world.takeSnapshot())
    clone.timestep = world.timestep
    const bodies = entries.map((entry) => clone?.getRigidBody(entry.body.handle))
    if (bodies.some((body) => !body)) return null
    const rolling: TrayOccupant[] = []
    entries.forEach((entry, slot) => {
      const body = bodies[slot]
      if (body && !held[entry.index]) rolling.push({ body, enteredTray: entry.enteredTray })
    })
    const maxSteps = Math.ceil(MAX_PREDICTION_SECONDS / clone.timestep)
    let stableSteps = 0
    for (let step = 0; step < maxSteps; step += 1) {
      clone.step()
      containDiceInTray(rolling)
      stableSteps = rolling.every((occupant) => isBodySettled(occupant.body)) ? stableSteps + 1 : 0
      if (stableSteps >= STABLE_STEPS) {
        return bodies.map((body) =>
          body ? topFaceFromQuaternion(body.rotation()) : 1,
        ) as unknown as PhysicsDiceSet
      }
    }
    return null
  } catch {
    return null
  } finally {
    clone?.free()
  }
}

function isBodySettled(body: RAPIER.RigidBody) {
  if (body.isSleeping()) return true
  const linear = body.linvel()
  const angular = body.angvel()
  return (
    Math.hypot(linear.x, linear.y, linear.z) < SETTLEMENT.linearSpeed &&
    Math.hypot(angular.x, angular.y, angular.z) < SETTLEMENT.angularSpeed
  )
}
