import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { PHYSICS_DICE_CONFIG } from './config'
import {
  cubeAlignmentOffset,
  type DiceTrajectoryFrame,
  type DiceTrajectoryPlan,
  planDiceTrajectory,
} from './remap'
import type { DieEntry } from './runtimeTypes'
import type { PhysicsDiceIndex, PhysicsDiceRollRequest, PhysicsHeldDice } from './types'

const CONFIG = PHYSICS_DICE_CONFIG
const SCENE = CONFIG.scene

/**
 * 그릇에서 쏟아진 뒤의 주사위 — 방출 임펄스와 **정해진 눈으로 끝나는 궤적의 재생**.
 *
 * 물리를 그대로 흘려보내지 않고 미리 계획한 궤적을 되감아 트는 이유는 결과가 서버에서
 * 이미 정해져 오기 때문이다(`request.targetDice`). 월드에서 떼어 낸 것은 이 계산이
 * 월드의 나머지와 상태를 나눠 갖지 않아서다.
 */

/** 그릇을 치우고 잡히지 않은 주사위를 부채꼴로 흩뿌린다. */
export function releaseDiceFromBowl(params: {
  readonly bowlBody: { setTranslation(t: THREE.Vector3Like, wake: boolean): void }
  readonly entries: readonly DieEntry[]
  readonly held: PhysicsHeldDice
  readonly random: { next(): number }
}): void {
  const { bowlBody, entries, held, random } = params

  bowlBody.setTranslation({ x: 10, y: -5, z: 0 }, true)
  const active = entries.filter((entry) => !held[entry.index])
  active.forEach((entry, index) => {
    entry.enteredTray = false
    const fan = index - (active.length - 1) / 2
    const force = CONFIG.defaults.throwForce
    const velocity = entry.body.linvel()
    const targetX =
      (SCENE.bowl.spillMinimumSpeed + random.next() * SCENE.bowl.spillRandomSpeed) *
      force *
      SCENE.bowl.spillForceMultiplier *
      SCENE.bowl.spillDirectionX
    entry.body.setLinvel(
      {
        x: targetX,
        y: Math.max(velocity.y * 0.2, SCENE.bowl.spillLiftSpeed * force),
        z: fan * SCENE.bowl.spillFanSpeed * force + (random.next() - 0.5) * SCENE.bowl.spillRandomZ,
      },
      true,
    )
    const angular = entry.body.angvel()
    entry.body.setAngvel(
      {
        x: angular.x * 0.4,
        y: angular.y * 0.4,
        z: angular.z * 0.4,
      },
      true,
    )
  })
}

/**
 * 궤적을 계획하고 주사위를 재생 모드로 바꾼다(물리 몸체를 고정으로 돌린다).
 *
 * @returns 계획한 궤적. 계획할 수 없으면 `null`이며 그때 `onError`가 이미 불렸다.
 */
export function beginTrajectoryReplay(params: {
  readonly world: RAPIER.World
  readonly entries: readonly DieEntry[]
  readonly held: PhysicsHeldDice
  readonly request: PhysicsDiceRollRequest
  readonly onError: (error: Error) => void
}): DiceTrajectoryPlan | null {
  const { world, entries, held, request, onError } = params
  const trajectory = planDiceTrajectory(world, [...entries], held, request.seed)
  if (!trajectory) {
    onError(new Error('주사위 궤적을 계산하지 못했습니다.'))
    return null
  }
  entries.forEach((entry) => {
    if (held[entry.index]) return
    entry.visualOffset.copy(
      cubeAlignmentOffset(request.targetDice[entry.index], trajectory.naturalDice[entry.index]),
    )
    entry.body.setBodyType(RAPIER.RigidBodyType.Fixed, true)
  })
  return trajectory
}

/**
 * 궤적의 한 프레임을 그린다.
 *
 * @returns 다음 프레임 인덱스와, 궤적이 끝나 결과 정렬로 넘어갈 때인지.
 */
export function playTrajectoryFrame(params: {
  readonly trajectory: DiceTrajectoryPlan
  readonly trajectoryStartedAt: number
  readonly trajectoryFrameIndex: number
  readonly time: number
  readonly entries: readonly DieEntry[]
  readonly held: PhysicsHeldDice
  readonly fallingDice: boolean[]
  readonly lastImpactAt: number[]
  readonly onDiceImpact?: ((index: PhysicsDiceIndex, strength: number) => void) | undefined
}): { readonly frameIndex: number; readonly finished: boolean } {
  const { trajectory, trajectoryStartedAt, time, entries, held, fallingDice, lastImpactAt } = params
  const { onDiceImpact } = params
  let trajectoryFrameIndex = params.trajectoryFrameIndex
  const elapsed = Math.min(
    trajectory.durationSeconds,
    Math.max(0, (time - trajectoryStartedAt) / 1000),
  )
  while (trajectoryFrameIndex + 1 < trajectory.frames.length) {
    const next = trajectory.frames[trajectoryFrameIndex + 1]
    if (!next || next.atSeconds > elapsed) break
    trajectoryFrameIndex += 1
  }
  const from = trajectory.frames[trajectoryFrameIndex]
  const to = trajectory.frames[Math.min(trajectoryFrameIndex + 1, trajectory.frames.length - 1)]
  if (!from || !to) return { frameIndex: trajectoryFrameIndex, finished: false }
  const span = to.atSeconds - from.atSeconds
  const progress = span > 0 ? (elapsed - from.atSeconds) / span : 0
  detectTrajectoryImpacts({
    from,
    to,
    time,
    entries,
    held,
    fallingDice,
    lastImpactAt,
    onDiceImpact,
  })
  entries.forEach((entry, index) => {
    if (held[entry.index]) return
    const fromPose = from.poses[index]
    const toPose = to.poses[index]
    if (!fromPose || !toPose) return
    entry.mesh.position.set(
      THREE.MathUtils.lerp(fromPose.position.x, toPose.position.x, progress),
      THREE.MathUtils.lerp(fromPose.position.y, toPose.position.y, progress),
      THREE.MathUtils.lerp(fromPose.position.z, toPose.position.z, progress),
    )
    entry.mesh.quaternion
      .set(fromPose.rotation.x, fromPose.rotation.y, fromPose.rotation.z, fromPose.rotation.w)
      .slerp(
        new THREE.Quaternion(
          toPose.rotation.x,
          toPose.rotation.y,
          toPose.rotation.z,
          toPose.rotation.w,
        ),
        progress,
      )
      .multiply(entry.visualOffset)
  })
  if (elapsed < trajectory.durationSeconds) {
    return { frameIndex: trajectoryFrameIndex, finished: false }
  }
  entries.forEach((entry) => {
    if (held[entry.index]) return
    entry.body.setTranslation(entry.mesh.position, true)
    entry.body.setRotation(entry.mesh.quaternion, true)
    entry.visualOffset.identity()
  })
  return { frameIndex: trajectoryFrameIndex, finished: true }
}

/**
 * 떨어지다 튀어 오르는 순간을 잡아 촉각·소리 신호를 보낸다. 같은 주사위가 연달아
 * 울리지 않도록 80ms를 둔다.
 */
function detectTrajectoryImpacts(params: {
  readonly from: DiceTrajectoryFrame
  readonly to: DiceTrajectoryFrame
  readonly time: number
  readonly entries: readonly DieEntry[]
  readonly held: PhysicsHeldDice
  readonly fallingDice: boolean[]
  readonly lastImpactAt: number[]
  readonly onDiceImpact?: ((index: PhysicsDiceIndex, strength: number) => void) | undefined
}): void {
  const { from, to, time, entries, held, fallingDice, lastImpactAt, onDiceImpact } = params

  const span = to.atSeconds - from.atSeconds
  if (span <= 0) return
  entries.forEach((entry, index) => {
    if (held[entry.index]) return
    const fromPose = from.poses[index]
    const toPose = to.poses[index]
    if (!fromPose || !toPose) return
    const verticalSpeed = (toPose.position.y - fromPose.position.y) / span
    if (verticalSpeed < -0.8) fallingDice[entry.index] = true
    if (
      fallingDice[entry.index] &&
      verticalSpeed > 0.45 &&
      time - (lastImpactAt[entry.index] ?? 0) >= 80
    ) {
      lastImpactAt[entry.index] = time
      fallingDice[entry.index] = false
      onDiceImpact?.(entry.index, Math.min(1, verticalSpeed / 4))
    }
  })
}
