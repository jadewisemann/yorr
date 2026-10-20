import * as THREE from 'three'
import { cubeAlignmentOffset, type DiceTrajectoryPlan } from './remap'
import type { DieEntry } from './runtimeTypes'
import type { PhysicsDiceIndex, PhysicsDiceSet, PhysicsHeldDice } from './types'

/**
 * 궤적 재생의 순수 부분 — 프레임 사이를 보간하고, 착지 충격을 판정하고, 마지막 자세를
 * 물리 바디에 되돌린다. 진행 상태(프레임 인덱스·시작 시각)는 `PhysicsDiceWorld`가 진다.
 */

export interface TrajectoryStep {
  elapsed: number
  frameIndex: number
  from: DiceTrajectoryPlan['frames'][number]
  to: DiceTrajectoryPlan['frames'][number]
}

/** 경과 시간에 맞는 프레임 구간을 찾는다. 프레임 인덱스는 뒤로 가지 않는다. */
export function trajectoryStep(
  trajectory: DiceTrajectoryPlan,
  startedAt: number,
  frameIndex: number,
  time: number,
): TrajectoryStep {
  const elapsed = Math.min(trajectory.durationSeconds, Math.max(0, (time - startedAt) / 1000))
  let index = frameIndex
  while (index + 1 < trajectory.frames.length) {
    const next = trajectory.frames[index + 1]
    if (!next || next.atSeconds > elapsed) break
    index += 1
  }
  const from = trajectory.frames[index]
  const to = trajectory.frames[Math.min(index + 1, trajectory.frames.length - 1)]
  // frames가 비어 있지 않다는 것은 planDiceTrajectory의 계약이다.
  return { elapsed, frameIndex: index, from: from!, to: to! }
}

/** 두 프레임 사이를 보간해 메시 자세를 갱신한다. `visualOffset`은 결과 눈을 맞추는 보정이다. */
export function applyTrajectoryPose(
  step: TrajectoryStep,
  entries: DieEntry[],
  held: PhysicsHeldDice,
) {
  const span = step.to.atSeconds - step.from.atSeconds
  const progress = span > 0 ? (step.elapsed - step.from.atSeconds) / span : 0
  for (const entry of entries) {
    if (held[entry.index]) continue
    const fromPose = step.from.poses[entry.index]
    const toPose = step.to.poses[entry.index]
    if (!fromPose || !toPose) continue
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
  }
}

export interface TrajectoryImpact {
  index: PhysicsDiceIndex
  strength: number
}

/**
 * 하강 중이던 주사위가 상승으로 뒤집히는 순간을 착지로 본다. 80ms 안의 반복은 하나로 센다.
 * `falling`·`lastImpactAt`을 제자리에서 갱신한다(호출자가 상태를 소유한다).
 */
export function detectTrajectoryImpacts(
  step: TrajectoryStep,
  entries: DieEntry[],
  held: PhysicsHeldDice,
  falling: boolean[],
  lastImpactAt: number[],
  time: number,
): TrajectoryImpact[] {
  const span = step.to.atSeconds - step.from.atSeconds
  if (span <= 0) return []
  const impacts: TrajectoryImpact[] = []
  entries.forEach((entry, index) => {
    if (held[entry.index]) return
    const fromPose = step.from.poses[index]
    const toPose = step.to.poses[index]
    if (!fromPose || !toPose) return
    const verticalSpeed = (toPose.position.y - fromPose.position.y) / span
    if (verticalSpeed < -0.8) falling[entry.index] = true
    if (
      falling[entry.index] &&
      verticalSpeed > 0.45 &&
      time - (lastImpactAt[entry.index] ?? 0) >= 80
    ) {
      lastImpactAt[entry.index] = time
      falling[entry.index] = false
      impacts.push({ index: entry.index, strength: Math.min(1, verticalSpeed / 4) })
    }
  })
  return impacts
}

/** 재생이 끝난 뒤 메시 자세를 물리 바디로 옮기고 보정을 지운다. */
export function commitTrajectoryPose(entries: DieEntry[], held: PhysicsHeldDice) {
  for (const entry of entries) {
    if (held[entry.index]) continue
    entry.body.setTranslation(entry.mesh.position, true)
    entry.body.setRotation(entry.mesh.quaternion, true)
    entry.visualOffset.identity()
  }
}

/** 재생 시작 시 목표 눈과 자연스러운 눈의 차이를 보정값으로 잡는다. */
export function applyTrajectoryOffset(
  entries: DieEntry[],
  held: PhysicsHeldDice,
  targetDice: PhysicsDiceSet,
  naturalDice: PhysicsDiceSet,
) {
  for (const entry of entries) {
    if (held[entry.index]) continue
    entry.visualOffset.copy(cubeAlignmentOffset(targetDice[entry.index], naturalDice[entry.index]))
  }
}
