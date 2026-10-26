import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { faceNormalForValue } from './model'
import { diceTrajectoryIssueScore } from './remapScore'
import { simulateDiceTrajectory } from './remapSimulation'
import type { PhysicsDiceSet, PhysicsDiceValue, PhysicsHeldDice } from './types'

/**
 * 주사위 예측의 **계획 수립** — 여러 시도 중 문제 점수가 가장 낮은 궤적을 고른다.
 *
 * 갈라 둔 파일:
 * - `remapSimulation.ts` — 시뮬레이션 한 번(스냅샷 복제·스텝 루프·프레임)
 * - `remapRetry.ts` — 재시도 흩뿌리기와 눌러 내리기
 * - `remapScore.ts` — 배치 품질 점수
 *
 * 이 파일은 공개 진입점과 그 선택 규칙만 남긴다. 기존 소비자(World·테스트)의
 * import 경로를 유지하려고 타입과 시뮬레이션 심볼을 re-export한다.
 */

const MAX_TRAJECTORY_ATTEMPTS = 3

export type {
  DiceTrajectoryFrame,
  DiceTrajectoryPlan,
  DiceTrajectoryPose,
  PredictableDie,
} from './remapScore'
export { diceTrajectoryIssueScore } from './remapScore'
export {
  captureTrajectoryFrame,
  isBodySettled,
  MAX_PREDICTION_SECONDS,
  type SimulationInput,
  simulateDiceTrajectory,
} from './remapSimulation'

import type { DiceTrajectoryPlan, PredictableDie } from './remapScore'

/**
 * 목표 면이 위로 오도록 하는 회전.
 *
 * 같은 면이면 항등, 반대면이면 수직축(또는 X축) 180° 회전, 그 밖에는 최단 회전이다.
 * `dot` 임계(±0.5)가 90° 경계다 — 그 근처에서는 두 방법이 비슷한 각도를 만든다.
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

/** 지금 상태를 한 번 더 굴렸을 때 나올 면들 — 계획 없이 자연 결과만 본다. */
export function predictNaturalDice(
  world: RAPIER.World,
  entries: PredictableDie[],
  held: PhysicsHeldDice,
): PhysicsDiceSet | null {
  return (
    simulateDiceTrajectory(world.takeSnapshot(), world.timestep, {
      entries,
      held,
      seed: 0,
      attempt: 0,
    })?.naturalDice ?? null
  )
}

/**
 * 최선의 궤적 계획. 문제 점수가 0이면 즉시 확정하고, 아니면 시도 중 가장 낮은 것을
 * 쓴다. 세 번 모두 실패하면 `null` — 호출자가 폴백(연출 생략)을 고른다.
 */
export function planDiceTrajectory(
  world: RAPIER.World,
  entries: PredictableDie[],
  held: PhysicsHeldDice,
  seed = 0,
): DiceTrajectoryPlan | null {
  const snapshot = world.takeSnapshot()
  let best: { plan: DiceTrajectoryPlan; issueScore: number } | null = null
  for (let attempt = 0; attempt < MAX_TRAJECTORY_ATTEMPTS; attempt += 1) {
    const plan = simulateDiceTrajectory(snapshot, world.timestep, { entries, held, seed, attempt })
    if (!plan) continue
    const issueScore = diceTrajectoryIssueScore(plan, entries, held)
    if (issueScore === 0) return plan
    if (!best || issueScore < best.issueScore) best = { plan, issueScore }
  }
  return best?.plan ?? null
}
