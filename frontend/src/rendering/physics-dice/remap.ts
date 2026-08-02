import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { PHYSICS_DICE_CONFIG } from './config'
import { faceNormalForValue, topFaceFromQuaternion } from './model'
import { createPhysicsDiceRandom } from './random'
import { containDiceInTray, type TrayOccupant } from './safety'
import type { PhysicsDiceIndex, PhysicsDiceSet, PhysicsDiceValue, PhysicsHeldDice } from './types'

const SETTLEMENT = PHYSICS_DICE_CONFIG.scene.settlement
/**
 * 예측 시뮬은 한 프레임 안에서 동기로 끝까지 돌리므로 상한이 곧 최악의 프레임 지연이다.
 * simulationHz가 480이므로 긴 상한은 메인 스레드를 오래 막는다. 제품의 강제 종료 시간까지만
 * 계산하고, 그 시점의 마지막 자세까지 궤적에 포함해 예측과 화면 재생이 갈리지 않게 한다.
 */
const MAX_PREDICTION_SECONDS = Math.max(4, SETTLEMENT.maxRollDurationMs / 1000)
/** 스텝이 아니라 시간으로 잡는다 — simulationHz를 바꿔도 "얼마나 가만히 있었나"가 같아야 한다. */
const STABLE_SECONDS = 0.12
const TRAJECTORY_FPS = 60
const MAX_TRAJECTORY_ATTEMPTS = 3
const RETRY_FAN_SPEED_STEP = 0.3
const RETRY_RANDOM_SPEED = 0.1
const RETRY_ANGULAR_SPEED = 0.8
const MAX_FLOOR_ASSISTS = 2

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
 * 쏟아짐 직후 호출해야 하며, 실제 화면은 별도 재시뮬레이션 대신 함께 만든 궤적을 재생한다.
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
  return (
    simulateDiceTrajectory(world.takeSnapshot(), world.timestep, entries, held, 0, 0)
      ?.naturalDice ?? null
  )
}

/**
 * 던지는 순간의 월드를 한 번만 끝까지 계산해 자연 착지 눈과 화면 재생용 궤적을 함께 만든다.
 * 호출부는 이 궤적을 그대로 재생해야 한다 — 다시 실시간 물리를 돌리면 카오스적인 충돌 오차로
 * 예측 눈과 실제 착지 눈이 갈릴 수 있다.
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
    const plan = simulateDiceTrajectory(snapshot, world.timestep, entries, held, seed, attempt)
    if (!plan) continue
    const issueScore = diceTrajectoryIssueScore(plan, entries, held)
    if (issueScore === 0) return plan
    if (!best || issueScore < best.issueScore) best = { plan, issueScore }
  }
  return best?.plan ?? null
}

function simulateDiceTrajectory(
  snapshot: Uint8Array,
  timestep: number,
  entries: PredictableDie[],
  held: PhysicsHeldDice,
  seed: number,
  attempt: number,
): DiceTrajectoryPlan | null {
  let clone: RAPIER.World | null = null
  try {
    clone = RAPIER.World.restoreSnapshot(snapshot)
    clone.timestep = timestep
    const bodies = entries.map((entry) => clone?.getRigidBody(entry.body.handle))
    if (bodies.some((body) => !body)) return null
    applyRetrySpread(bodies, entries, held, seed, attempt)
    const rolling: TrayOccupant[] = []
    entries.forEach((entry, slot) => {
      const body = bodies[slot]
      if (body && !held[entry.index]) rolling.push({ body, enteredTray: entry.enteredTray })
    })
    const maxSteps = Math.ceil(MAX_PREDICTION_SECONDS / clone.timestep)
    const stableTarget = Math.max(1, Math.round(STABLE_SECONDS / clone.timestep))
    const sampleEvery = Math.max(1, Math.round(1 / (TRAJECTORY_FPS * clone.timestep)))
    const frames: DiceTrajectoryFrame[] = []
    captureTrajectoryFrame(frames, bodies, 0)
    let stableSteps = 0
    let floorAssists = 0
    for (let step = 0; step < maxSteps; step += 1) {
      clone.step()
      containDiceInTray(rolling)
      const elapsed = (step + 1) * clone.timestep
      if ((step + 1) % sampleEvery === 0) captureTrajectoryFrame(frames, bodies, elapsed)
      stableSteps = rolling.every((occupant) => isBodySettled(occupant.body)) ? stableSteps + 1 : 0
      if (stableSteps >= stableTarget) {
        if (
          floorAssists < MAX_FLOOR_ASSISTS &&
          pressStandingDice(bodies, entries, held, seed, attempt, floorAssists)
        ) {
          floorAssists += 1
          stableSteps = 0
          continue
        }
        captureFinalFrame(frames, bodies, elapsed)
        return createTrajectoryPlan(attempt, elapsed, floorAssists, frames, bodies, true)
      }
    }
    const elapsed = maxSteps * clone.timestep
    captureFinalFrame(frames, bodies, elapsed)
    return createTrajectoryPlan(attempt, elapsed, floorAssists, frames, bodies, false)
  } catch {
    return null
  } finally {
    clone?.free()
  }
}

function captureTrajectoryFrame(
  frames: DiceTrajectoryFrame[],
  bodies: Array<RAPIER.RigidBody | undefined>,
  atSeconds: number,
) {
  const poses = bodies.map((body) => {
    if (!body) throw new Error('Missing trajectory body')
    const position = body.translation()
    const rotation = body.rotation()
    return {
      position: { x: position.x, y: position.y, z: position.z },
      rotation: { w: rotation.w, x: rotation.x, y: rotation.y, z: rotation.z },
    }
  })
  frames.push({ atSeconds, poses })
}

function captureFinalFrame(
  frames: DiceTrajectoryFrame[],
  bodies: Array<RAPIER.RigidBody | undefined>,
  atSeconds: number,
) {
  if (frames.at(-1)?.atSeconds !== atSeconds) captureTrajectoryFrame(frames, bodies, atSeconds)
}

function createTrajectoryPlan(
  attempt: number,
  durationSeconds: number,
  floorAssists: number,
  frames: DiceTrajectoryFrame[],
  bodies: Array<RAPIER.RigidBody | undefined>,
  settled: boolean,
): DiceTrajectoryPlan {
  const naturalDice = bodies.map((body) =>
    body ? topFaceFromQuaternion(body.rotation()) : 1,
  ) as unknown as PhysicsDiceSet
  return { attempt, durationSeconds, floorAssists, frames, naturalDice, settled }
}

function pressStandingDice(
  bodies: Array<RAPIER.RigidBody | undefined>,
  entries: PredictableDie[],
  held: PhysicsHeldDice,
  seed: number,
  attempt: number,
  assist: number,
) {
  const width = PHYSICS_DICE_CONFIG.defaults.diceSize * PHYSICS_DICE_CONFIG.scene.bowlDiceScale
  const active = entries
    .map((entry, slot) => ({ body: bodies[slot], entry }))
    .filter(
      (item): item is { body: RAPIER.RigidBody; entry: PredictableDie } =>
        Boolean(item.body) && !held[item.entry.index],
    )
  let pressed = false
  active.forEach(({ body, entry }) => {
    const position = body.translation()
    if (position.y <= width / 2 + width * 0.18) return
    const supportedByDie = active.some(({ body: other }) => {
      if (other.handle === body.handle) return false
      const otherPosition = other.translation()
      return (
        otherPosition.y < position.y - width * 0.35 &&
        Math.hypot(otherPosition.x - position.x, otherPosition.z - position.z) < width * 0.82
      )
    })
    if (supportedByDie) return
    const random = createPhysicsDiceRandom(retrySeed(seed, attempt + assist + 11, entry.index))
    const angle = random.next() * Math.PI * 2
    body.applyImpulseAtPoint(
      { x: 0, y: -PHYSICS_DICE_CONFIG.defaults.mass, z: 0 },
      {
        x: position.x + Math.cos(angle) * width * 0.35,
        y: position.y,
        z: position.z + Math.sin(angle) * width * 0.35,
      },
      true,
    )
    pressed = true
  })
  return pressed
}

function applyRetrySpread(
  bodies: Array<RAPIER.RigidBody | undefined>,
  entries: PredictableDie[],
  held: PhysicsHeldDice,
  seed: number,
  attempt: number,
) {
  if (attempt === 0) return
  const rollingSlots = entries
    .map((entry, slot) => ({ entry, slot }))
    .filter(({ entry }) => !held[entry.index])
  rollingSlots.forEach(({ entry, slot }, rank) => {
    const body = bodies[slot]
    if (!body) return
    const random = createPhysicsDiceRandom(retrySeed(seed, attempt, entry.index))
    const velocity = body.linvel()
    const fan =
      (rank - (rollingSlots.length - 1) / 2) / Math.max(0.5, (rollingSlots.length - 1) / 2)
    body.setLinvel(
      {
        x:
          velocity.x +
          (random.next() - 0.5) *
            RETRY_RANDOM_SPEED *
            PHYSICS_DICE_CONFIG.defaults.throwForce *
            attempt,
        y: velocity.y,
        z:
          velocity.z +
          (fan * RETRY_FAN_SPEED_STEP + (random.next() - 0.5) * RETRY_RANDOM_SPEED) *
            PHYSICS_DICE_CONFIG.defaults.throwForce *
            attempt,
      },
      true,
    )
    const angular = body.angvel()
    body.setAngvel(
      {
        x: angular.x + (random.next() - 0.5) * 2 * RETRY_ANGULAR_SPEED * attempt,
        y: angular.y,
        z: angular.z + (random.next() - 0.5) * 2 * RETRY_ANGULAR_SPEED * attempt,
      },
      true,
    )
    body.wakeUp()
  })
}

function retrySeed(seed: number, attempt: number, index: PhysicsDiceIndex) {
  let mixed =
    (Math.trunc(seed) ^ Math.imul(attempt, 0x9e3779b9) ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d)
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b)
  return (mixed ^ (mixed >>> 16)) >>> 0
}

export function diceTrajectoryIssueScore(
  plan: DiceTrajectoryPlan,
  entries: PredictableDie[],
  held: PhysicsHeldDice,
) {
  const finalPoses = plan.frames.at(-1)?.poses
  if (!finalPoses) return Number.POSITIVE_INFINITY
  const colliderWidth =
    PHYSICS_DICE_CONFIG.defaults.diceSize *
    PHYSICS_DICE_CONFIG.scene.colliderHalfRatio *
    PHYSICS_DICE_CONFIG.scene.bowlDiceScale *
    2
  const visualWidth =
    PHYSICS_DICE_CONFIG.defaults.diceSize * PHYSICS_DICE_CONFIG.scene.bowlDiceScale
  const overlapThresholdSq = (colliderWidth * 0.65) ** 2
  const horizontalThresholdSq = (visualWidth * 0.82) ** 2
  const verticalThreshold = visualWidth * 0.45
  const overlapScore = plan.frames.reduce(
    (score, frame) => Math.max(score, frameOverlapScore(frame, entries, held, overlapThresholdSq)),
    plan.settled ? 0 : 1_000,
  )
  return (
    overlapScore +
    finalPoseIssueScore(
      finalPoses,
      entries,
      held,
      colliderWidth,
      visualWidth,
      horizontalThresholdSq,
      verticalThreshold,
    )
  )
}

function frameOverlapScore(
  frame: DiceTrajectoryFrame,
  entries: PredictableDie[],
  held: PhysicsHeldDice,
  overlapThresholdSq: number,
) {
  // 재시도는 시작 자세가 같으므로 사발을 막 벗어나는 공통 구간은 평가하지 않는다.
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

function finalPoseIssueScore(
  poses: DiceTrajectoryPose[],
  entries: PredictableDie[],
  held: PhysicsHeldDice,
  colliderWidth: number,
  visualWidth: number,
  horizontalThresholdSq: number,
  verticalThreshold: number,
) {
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

/** 물리적으로 멈췄는지. 예측 복제 시뮬과 실제 진행이 같은 기준을 쓰도록 여기서만 정의한다. */
export function isBodySettled(body: RAPIER.RigidBody) {
  if (body.isSleeping()) return true
  const linear = body.linvel()
  const angular = body.angvel()
  return (
    Math.hypot(linear.x, linear.y, linear.z) < SETTLEMENT.linearSpeed &&
    Math.hypot(angular.x, angular.y, angular.z) < SETTLEMENT.angularSpeed
  )
}
