import RAPIER from '@dimforge/rapier3d-compat'
import { PHYSICS_DICE_CONFIG } from './config'
import { topFaceFromQuaternion } from './model'
import { pressStandingDice, spreadOnRetry } from './remapRetry'
import type { DiceTrajectoryFrame, DiceTrajectoryPlan, PredictableDie } from './remapScore'
import { containDiceInTray, type TrayOccupant } from './safety'
import type { PhysicsDiceSet, PhysicsHeldDice } from './types'

/**
 * 예측 시뮬레이션 **한 번의 실행** — 스냅샷 복제, 스텝 루프, 프레임 캡처, 정착 판정.
 *
 * `remap.ts`에서 갈라 둔 이유: 계획 루프(시도 여러 번 중 최선 선택)와 본체가 다른
 * 관심사다. 이 파일은 "이 스냅샷에서 4초 돌리면 무슨 일이 나는가"만 답한다.
 */

const SETTLEMENT = PHYSICS_DICE_CONFIG.scene.settlement
export const MAX_PREDICTION_SECONDS = Math.max(4, SETTLEMENT.maxRollDurationMs / 1000)
const STABLE_SECONDS = 0.12
const TRAJECTORY_FPS = 60
const MAX_FLOOR_ASSISTS = 2

/** 시뮬레이션 한 번의 입력 — 같은 주사위·같은 시드에서 같은 결과가 나와야 하므로 함께 다닌다. */
export interface SimulationInput {
  readonly entries: PredictableDie[]
  readonly held: PhysicsHeldDice
  readonly seed: number
  readonly attempt: number
}

export function simulateDiceTrajectory(
  snapshot: Uint8Array,
  timestep: number,
  { entries, held, seed, attempt }: SimulationInput,
): DiceTrajectoryPlan | null {
  let clone: RAPIER.World | null = null
  try {
    clone = RAPIER.World.restoreSnapshot(snapshot)
    clone.timestep = timestep
    const bodies = entries.map((entry) => clone?.getRigidBody(entry.body.handle))
    if (bodies.some((body) => !body)) return null
    spreadOnRetry(bodies, { entries, held, seed, attempt })
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
          pressStandingDice(bodies, { entries, held, seed, attempt }, floorAssists)
        ) {
          floorAssists += 1
          stableSteps = 0
          continue
        }
        captureFinalFrame(frames, bodies, elapsed)
        return createTrajectoryPlan({
          attempt,
          bodies,
          durationSeconds: elapsed,
          floorAssists,
          frames,
          settled: true,
        })
      }
    }
    const elapsed = maxSteps * clone.timestep
    captureFinalFrame(frames, bodies, elapsed)
    return createTrajectoryPlan({
      attempt,
      bodies,
      durationSeconds: elapsed,
      floorAssists,
      frames,
      settled: false,
    })
  } catch {
    return null
  } finally {
    clone?.free()
  }
}

export function captureTrajectoryFrame(
  frames: DiceTrajectoryFrame[],
  bodies: Array<RAPIER.RigidBody | undefined>,
  atSeconds: number,
): void {
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

/** 마지막 프레임 중복을 피해 붙인다. */
function captureFinalFrame(
  frames: DiceTrajectoryFrame[],
  bodies: Array<RAPIER.RigidBody | undefined>,
  atSeconds: number,
): void {
  if (frames.at(-1)?.atSeconds !== atSeconds) captureTrajectoryFrame(frames, bodies, atSeconds)
}

interface TrajectoryPlanInput {
  attempt: number
  durationSeconds: number
  floorAssists: number
  frames: DiceTrajectoryFrame[]
  bodies: Array<RAPIER.RigidBody | undefined>
  settled: boolean
}

function createTrajectoryPlan({
  attempt,
  durationSeconds,
  floorAssists,
  frames,
  bodies,
  settled,
}: TrajectoryPlanInput): DiceTrajectoryPlan {
  const naturalDice = bodies.map((body) =>
    body ? topFaceFromQuaternion(body.rotation()) : 1,
  ) as unknown as PhysicsDiceSet
  return { attempt, durationSeconds, floorAssists, frames, naturalDice, settled }
}

export function isBodySettled(body: RAPIER.RigidBody): boolean {
  if (body.isSleeping()) return true
  const linear = body.linvel()
  const angular = body.angvel()
  return (
    Math.hypot(linear.x, linear.y, linear.z) < SETTLEMENT.linearSpeed &&
    Math.hypot(angular.x, angular.y, angular.z) < SETTLEMENT.angularSpeed
  )
}
