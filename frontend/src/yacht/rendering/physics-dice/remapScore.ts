import type RAPIER from '@dimforge/rapier3d-compat'
import { PHYSICS_DICE_CONFIG } from './config'
import type { PhysicsDiceIndex, PhysicsDiceSet, PhysicsHeldDice } from './types'

/** 예측 대상 주사위 — 리맵 절차가 들고 다니는 최소 정보. */
export interface PredictableDie {
  body: RAPIER.RigidBody
  enteredTray: boolean
  index: PhysicsDiceIndex
}

export interface DiceTrajectoryPose {
  position: { x: number; y: number; z: number }
  rotation: { w: number; x: number; y: number; z: number }
}

export interface DiceTrajectoryFrame {
  atSeconds: number
  poses: DiceTrajectoryPose[]
}

export interface DiceTrajectoryPlan {
  attempt: number
  durationSeconds: number
  floorAssists: number
  frames: DiceTrajectoryFrame[]
  naturalDice: PhysicsDiceSet
  settled: boolean
}

/**
 * 예측 궤적의 **품질 점수** — 겹침·높이·기울어진 자세를 수치로 매겨 리맵 후보를 고른다.
 *
 * `remap.ts`에서 갈라 둔 이유: 이 점수들은 리맵 절차(재시도·분산·눌러 세우기)와
 * 무관하다. "어떤 배치가 나쁜가"를 조정할 때 리맵 루프를 지나치지 않게 하고,
 * 임계값이 한 파일에 모여 있게 한다.
 */

/** 기하 치수에서 나오는 임계값. 매 프레임 다시 계산하지 않도록 한 번에 만든다. */
const dimensions = () => {
  const colliderWidth =
    PHYSICS_DICE_CONFIG.defaults.diceSize *
    PHYSICS_DICE_CONFIG.scene.colliderHalfRatio *
    PHYSICS_DICE_CONFIG.scene.bowlDiceScale *
    2
  const visualWidth =
    PHYSICS_DICE_CONFIG.defaults.diceSize * PHYSICS_DICE_CONFIG.scene.bowlDiceScale
  return {
    colliderWidth,
    visualWidth,
    overlapThresholdSq: (colliderWidth * 0.65) ** 2,
    horizontalThresholdSq: (visualWidth * 0.82) ** 2,
    verticalThreshold: visualWidth * 0.45,
  }
}

/** 궤적 전체의 문제 점수. 0이 완벽하고, 클수록 나쁘다(정착 실패는 1000+). */
export function diceTrajectoryIssueScore(
  plan: DiceTrajectoryPlan,
  entries: PredictableDie[],
  held: PhysicsHeldDice,
): number {
  const finalPoses = plan.frames.at(-1)?.poses
  if (!finalPoses) return Number.POSITIVE_INFINITY
  const dims = dimensions()
  const overlapScore = plan.frames.reduce(
    (score, frame) =>
      Math.max(score, frameOverlapScore(frame, entries, held, dims.overlapThresholdSq)),
    plan.settled ? 0 : 1_000,
  )
  return overlapScore + finalPoseIssueScore({ poses: finalPoses, entries, held, ...dims })
}

/**
 * 프레임 하나에서 **굴러가는 중인** 주사위끼리의 겹침. 시작 0.15초는 무시한다 —
 * 사발에 쏟아지는 순간에는 겹치는 것이 정상이다.
 */
function frameOverlapScore(
  frame: DiceTrajectoryFrame,
  entries: PredictableDie[],
  held: PhysicsHeldDice,
  overlapThresholdSq: number,
): number {
  if (frame.atSeconds < 0.15) return 0
  let score = 0
  for (let a = 0; a < entries.length; a += 1) {
    const entryA = entries[a]
    const poseA = frame.poses[a]
    if (!entryA || !poseA || held[entryA.index]) continue
    for (let b = a + 1; b < entries.length; b += 1) {
      const entryB = entries[b]
      const poseB = frame.poses[b]
      if (!entryB || !poseB || held[entryB.index]) continue
      const dx = poseA.position.x - poseB.position.x
      const dy = poseA.position.y - poseB.position.y
      const dz = poseA.position.z - poseB.position.z
      const distanceSq = dx * dx + dy * dy + dz * dz
      if (distanceSq < overlapThresholdSq) {
        score = Math.max(score, (overlapThresholdSq - distanceSq) / overlapThresholdSq)
      }
    }
  }
  return score
}

/** 마지막 자세 판정의 재료 — 치수·임계값이 항상 함께 계산돼 다닌다. */
interface FinalPoseInput {
  readonly poses: DiceTrajectoryPose[]
  readonly entries: PredictableDie[]
  readonly held: PhysicsHeldDice
  readonly colliderWidth: number
  readonly visualWidth: number
  readonly horizontalThresholdSq: number
  readonly verticalThreshold: number
}

/**
 * 마지막 자세가 **눕지 않았는가**를 벌점으로 매긴다.
 *
 * 두 가지를 본다: ① 바닥보다 높이 떠 있는가(벽에 걸린 자세) ② 수평으로 겹치는데
 * 높이 차가 큰가(쌓인 자세). 둘 다 사람 눈에는 "주사위가 이상하게 멈췄다"로 보인다.
 */
function finalPoseIssueScore({
  poses,
  entries,
  held,
  colliderWidth,
  visualWidth,
  horizontalThresholdSq,
  verticalThreshold,
}: FinalPoseInput): number {
  let score = 0
  for (let a = 0; a < entries.length; a += 1) {
    const entryA = entries[a]
    const poseA = poses[a]
    if (!entryA || !poseA || held[entryA.index]) continue
    const heightExcess = poseA.position.y - (colliderWidth / 2 + visualWidth * 0.2)
    if (heightExcess > 0) score += 1 + heightExcess / visualWidth
    for (let b = a + 1; b < entries.length; b += 1) {
      const entryB = entries[b]
      const poseB = poses[b]
      if (!entryB || !poseB || held[entryB.index]) continue
      const dx = poseA.position.x - poseB.position.x
      const dz = poseA.position.z - poseB.position.z
      const horizontalSq = dx * dx + dz * dz
      if (horizontalSq >= horizontalThresholdSq) continue
      const vertical = Math.abs(poseA.position.y - poseB.position.y)
      score +=
        (horizontalThresholdSq - horizontalSq) / horizontalThresholdSq +
        Math.max(0, vertical - verticalThreshold) / visualWidth
    }
  }
  return score
}
