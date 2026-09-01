import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { beforeAll, expect, it, vi } from 'vitest'
import { createBowl, createTray } from '@/yacht/rendering/physics-dice/arena'
import { PHYSICS_DICE_CONFIG } from '@/yacht/rendering/physics-dice/config'
import { createDiceInstances } from '@/yacht/rendering/physics-dice/diceInstances'
import { createPhysicsDiceRandom } from '@/yacht/rendering/physics-dice/random'
import {
  diceTrajectoryIssueScore,
  isBodySettled,
  planDiceTrajectory,
} from '@/yacht/rendering/physics-dice/remap'
import {
  containDiceInBowl,
  containDiceInTray,
  verticalHalfExtent,
} from '@/yacht/rendering/physics-dice/safety'
import type { PhysicsHeldDice } from '@/yacht/rendering/physics-dice/types'

// `vi.mock`은 부른 파일에만 걸린다 — 하네스로 옮길 수 없다.
vi.mock('three', async (importOriginal) => {
  const { threeWithFakeRenderer } = await import('@/test/threeStubs')
  return threeWithFakeRenderer(importOriginal)
})

const CONFIG = PHYSICS_DICE_CONFIG
const SCENE = CONFIG.scene
const NO_HELD: PhysicsHeldDice = [false, false, false, false, false]
const SEEDS = Array.from({ length: 24 }, (_, i) => 7 + i * 9173)
const RENDER_HZ = 60

function simulate(seed: number) {
  const scene = new THREE.Scene()
  const world = new RAPIER.World({ x: 0, y: -CONFIG.defaults.gravity, z: 0 })
  world.timestep = 1 / CONFIG.defaults.simulationHz
  createTray(scene, world)
  const { bowlBody } = createBowl(scene, world)
  const { entries } = createDiceInstances(scene, world)
  const random = createPhysicsDiceRandom(seed)
  const half = CONFIG.defaults.diceSize * SCENE.colliderHalfRatio * SCENE.bowlDiceScale
  const substepsPerFrame = Math.max(1, Math.round(CONFIG.defaults.simulationHz / RENDER_HZ))

  bowlBody.setTranslation(
    { x: SCENE.bowl.startX, y: SCENE.bowl.hoverY, z: SCENE.bowl.startZ },
    true,
  )
  entries.forEach((entry) => {
    entry.collider.setShape(new RAPIER.Cuboid(half, half, half))
    const angle = (entry.index / entries.length) * Math.PI * 2 - Math.PI / 2
    const radius = SCENE.bowl.spawnRadius + (random.next() - 0.5) * SCENE.bowl.spawnJitter
    entry.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
    entry.body.setLinearDamping(CONFIG.defaults.linearDamping)
    entry.body.setAngularDamping(CONFIG.defaults.angularDamping)
    entry.body.setSoftCcdPrediction(CONFIG.defaults.softCcdPrediction)
    entry.body.setTranslation(
      {
        x: SCENE.bowl.startX + Math.cos(angle) * radius,
        y: SCENE.bowl.hoverY + SCENE.bowl.spawnBaseY + random.next() * SCENE.bowl.spawnRangeY,
        z: SCENE.bowl.startZ + Math.sin(angle) * radius,
      },
      true,
    )
    entry.body.setLinvel(
      {
        x: (random.next() - 0.5) * CONFIG.defaults.spawnLinearSpeed,
        y: random.next() * CONFIG.defaults.spawnLiftSpeed,
        z: (random.next() - 0.5) * CONFIG.defaults.spawnLinearSpeed,
      },
      true,
    )
    entry.body.setAngvel(
      {
        x: (random.next() - 0.5) * CONFIG.defaults.spawnAngularSpeed,
        y: (random.next() - 0.5) * CONFIG.defaults.spawnAngularSpeed,
        z: (random.next() - 0.5) * CONFIG.defaults.spawnAngularSpeed,
      },
      true,
    )
    entry.body.wakeUp()
  })

  let bowlAngvelSum = 0
  let bowlSamples = 0
  let bowlAltSum = 0
  let bowlAltMin = Number.POSITIVE_INFINITY
  let bowlBottomClearanceMin = Number.POSITIVE_INFINITY
  let bowlAltMax = 0
  let lastKick = -1e9
  const shakeStrength = SCENE.bowl.shakeStrength
  const shakeSteps = Math.round(1.2 * CONFIG.defaults.simulationHz)
  for (let step = 0; step < shakeSteps; step += 1) {
    const timeMs = (step / CONFIG.defaults.simulationHz) * 1000
    const elapsed = timeMs / 1000
    const x = SCENE.bowl.startX + Math.sin(elapsed * 15) * SCENE.bowl.shakeOffsetX * shakeStrength
    const z =
      SCENE.bowl.startZ + Math.sin(elapsed * 19 + 0.8) * SCENE.bowl.shakeOffsetZ * shakeStrength
    const bvx = Math.cos(elapsed * 15) * 15 * SCENE.bowl.shakeOffsetX * shakeStrength
    const bvz = Math.cos(elapsed * 19 + 0.8) * 19 * SCENE.bowl.shakeOffsetZ * shakeStrength
    bowlBody.setNextKinematicTranslation({ x, y: SCENE.bowl.hoverY, z })
    if (timeMs - lastKick >= SCENE.bowl.shakeIntervalMs) {
      lastKick = timeMs
      const mass = CONFIG.defaults.mass
      const kickSlot = Math.floor(random.next() * entries.length)
      entries.forEach((entry, slot) => {
        const p = entry.body.translation()
        const v = entry.body.linvel()
        const kickRandom = random.next()
        const altitude = p.y - SCENE.bowl.hoverY
        const kickY =
          slot === kickSlot && altitude < SCENE.bowl.shakeKickAltitude
            ? Math.sqrt(
                2 * CONFIG.defaults.gravity * SCENE.bowl.shakeKickHeight * (0.3 + 0.7 * kickRandom),
              ) * mass
            : 0
        entry.body.applyImpulse(
          {
            x:
              (bvx - v.x) * SCENE.bowl.shakeFollowStrength * mass +
              ((x - p.x) * SCENE.bowl.shakeCenterStrength -
                (z - p.z) * SCENE.bowl.shakeOrbitStrength) *
                shakeStrength,
            y: kickY * shakeStrength,
            z:
              (bvz - v.z) * SCENE.bowl.shakeFollowStrength * mass +
              ((z - p.z) * SCENE.bowl.shakeCenterStrength +
                (x - p.x) * SCENE.bowl.shakeOrbitStrength) *
                shakeStrength,
          },
          true,
        )
        const torque = SCENE.bowl.shakeTorqueImpulse * shakeStrength
        entry.body.applyTorqueImpulse(
          {
            x: (random.next() - 0.5) * torque,
            y: (random.next() - 0.5) * torque,
            z: (random.next() - 0.5) * torque,
          },
          true,
        )
      })
    }
    world.step()
    containDiceInBowl(entries, NO_HELD, bowlBody)
    for (const entry of entries) {
      const a = entry.body.angvel()
      bowlAngvelSum += Math.hypot(a.x, a.y, a.z)
      bowlSamples += 1
      const alt = entry.body.translation().y - SCENE.bowl.hoverY
      bowlAltSum += alt
      bowlAltMin = Math.min(bowlAltMin, alt)
      bowlBottomClearanceMin = Math.min(
        bowlBottomClearanceMin,
        alt -
          SCENE.bowl.colliderBottomY -
          SCENE.bowl.colliderBottomHalfHeight -
          verticalHalfExtent(
            entry.body,
            CONFIG.defaults.diceSize * SCENE.colliderHalfRatio * SCENE.bowlDiceScale,
          ),
      )
      bowlAltMax = Math.max(bowlAltMax, alt)
    }
  }

  bowlBody.setTranslation({ x: 10, y: -5, z: 0 }, true)
  entries.forEach((entry, index) => {
    entry.enteredTray = false
    const fan = index - (entries.length - 1) / 2
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
  const plannedTrajectory = planDiceTrajectory(world, entries, NO_HELD, seed)
  const trajectoryIssue = plannedTrajectory
    ? diceTrajectoryIssueScore(plannedTrajectory, entries, NO_HELD)
    : Number.POSITIVE_INFINITY
  const trajectoryMaxY = Math.max(
    ...(plannedTrajectory?.frames.at(-1)?.poses.map((pose) => pose.position.y) ?? [
      Number.POSITIVE_INFINITY,
    ]),
  )

  let rotation = 0
  let apex = 0
  let travel = 0
  let maxPen = 0
  let maxSpeed = 0
  let minY = Number.POSITIVE_INFINITY
  let minBottomClearance = Number.POSITIVE_INFINITY
  let stableFrames = 0
  let settledMs: number | null = null
  const restY = CONFIG.defaults.diceSize * SCENE.bowlDiceScale * 0.5
  const startX = entries.map((e) => e.body.translation().x)
  const maxSteps = Math.round(30 * CONFIG.defaults.simulationHz)
  const wasFalling = entries.map(() => false)
  const bounceCount = entries.map(() => 0)
  let bounceApex = 0
  const bouncing = entries.map(() => false)

  for (let step = 0; step < maxSteps; step += 1) {
    world.step()
    containDiceInTray(entries)
    entries.forEach((entry, i) => {
      const a = entry.body.angvel()
      rotation += Math.hypot(a.x, a.y, a.z) * world.timestep
      const p = entry.body.translation()
      minY = Math.min(minY, p.y)
      minBottomClearance = Math.min(minBottomClearance, p.y - verticalHalfExtent(entry.body, restY))
      apex = Math.max(apex, p.y - restY)
      const v = entry.body.linvel()
      maxSpeed = Math.max(maxSpeed, Math.hypot(v.x, v.y, v.z))
      if (entry.enteredTray && p.y < restY * 3 && wasFalling[i] && v.y > 0.6) {
        bounceCount[i] = (bounceCount[i] ?? 0) + 1
        bouncing[i] = true
      }
      if (bouncing[i]) bounceApex = Math.max(bounceApex, p.y - restY)
      if (v.y < -0.4) wasFalling[i] = true
      else if (v.y > 0.4) wasFalling[i] = false
    })
    for (let a = 0; a < entries.length; a += 1) {
      for (let b = a + 1; b < entries.length; b += 1) {
        const ca = entries[a]?.collider
        const cb = entries[b]?.collider
        if (!ca || !cb) continue
        world.contactPair(ca, cb, (mf) => {
          for (let i = 0; i < mf.numContacts(); i += 1) {
            if (mf.contactDist(i) < 0) maxPen = Math.max(maxPen, -mf.contactDist(i))
          }
        })
      }
    }
    if (step % substepsPerFrame === 0) {
      stableFrames = entries.every((e) => isBodySettled(e.body)) ? stableFrames + 1 : 0
      if (stableFrames >= SCENE.settlement.stableFrames) {
        settledMs = Math.round((step / CONFIG.defaults.simulationHz) * 1000)
        break
      }
    }
  }
  entries.forEach((e, i) => {
    travel += Math.abs(e.body.translation().x - (startX[i] ?? 0))
  })
  const escaped = entries.some((e) => {
    const p = e.body.translation()
    return Math.abs(p.x) > SCENE.tray.entryApronMaxX || p.y < -1
  })
  const maxRestY = Math.max(...entries.map((e) => e.body.translation().y))
  let spreadSum = 0
  let spreadPairs = 0
  for (let a = 0; a < entries.length; a += 1) {
    for (let b = a + 1; b < entries.length; b += 1) {
      const pa = entries[a]?.body.translation()
      const pb = entries[b]?.body.translation()
      if (!pa || !pb) continue
      spreadSum += Math.hypot(pa.x - pb.x, pa.z - pb.z)
      spreadPairs += 1
    }
  }
  world.free()

  return {
    settledMs,
    turns: rotation / (2 * Math.PI) / entries.length,
    apex,
    travel: travel / entries.length,
    maxPen,
    maxSpeed,
    minY,
    minBottomClearance,
    escaped,
    bowlSpin: bowlAngvelSum / Math.max(1, bowlSamples),
    bowlAlt: bowlAltSum / Math.max(1, bowlSamples),
    bowlAltMin,
    bowlBottomClearanceMin,
    bowlAltMax,
    maxRestY,
    trajectoryIssue,
    trajectoryMaxY,
    bounces: bounceCount.reduce((s, n) => s + n, 0) / entries.length,
    bounceApex,
    spread: spreadSum / Math.max(1, spreadPairs),
  }
}

function measure() {
  const runs = SEEDS.map((seed) => simulate(seed))
  const hz = CONFIG.defaults.simulationHz
  const width = CONFIG.defaults.diceSize * SCENE.colliderHalfRatio * SCENE.bowlDiceScale * 2
  const avg = (pick: (r: (typeof runs)[0]) => number) =>
    runs.reduce((s, r) => s + pick(r), 0) / runs.length
  const settled = runs.filter((r) => r.settledMs !== null).map((r) => r.settledMs as number)
  return {
    settleAvg: Math.round(settled.reduce((a, b) => a + b, 0) / Math.max(1, settled.length)),
    settleMax: settled.length ? Math.max(...settled) : -1,
    hangs: runs.length - settled.length,
    turns: avg((r) => r.turns),
    apex: avg((r) => r.apex),
    travel: avg((r) => r.travel),
    maxPen: Math.max(...runs.map((r) => r.maxPen)),
    minY: Math.min(...runs.map((r) => r.minY)),
    minBottomClearance: Math.min(...runs.map((r) => r.minBottomClearance)),
    stepW: Math.max(...runs.map((r) => r.maxSpeed)) / hz / width,
    bowlSpin: avg((r) => r.bowlSpin),
    bowlAlt: avg((r) => r.bowlAlt),
    bowlAltMin: Math.min(...runs.map((r) => r.bowlAltMin)),
    bowlBottomClearanceMin: Math.min(...runs.map((r) => r.bowlBottomClearanceMin)),
    bowlAltMax: Math.max(...runs.map((r) => r.bowlAltMax)),
    escaped: runs.filter((r) => r.escaped).length,
    stacked: runs.filter((r) => r.maxRestY > width).length,
    invalidTrajectories: runs.filter((r) => r.trajectoryIssue > 0).length,
    invalidTrajectoryDetails: runs.flatMap((run, index) =>
      run.trajectoryIssue > 0
        ? [`${SEEDS[index]}:${run.trajectoryIssue.toFixed(2)}@y${run.trajectoryMaxY.toFixed(2)}`]
        : [],
    ),
    bounces: avg((r) => r.bounces),
    bounceApex: Math.max(...runs.map((r) => r.bounceApex)),
    spread: avg((r) => r.spread),
  }
}

let current: ReturnType<typeof measure>

beforeAll(async () => {
  await RAPIER.init()
  current = measure()
})

it('쏟은 주사위가 트레이 안에서 안착한다', () => {
  const speedup = Math.sqrt(CONFIG.defaults.gravity / 30)
  expect(current.hangs).toBe(0)
  expect(current.escaped).toBe(0)
  expect(current.settleAvg).toBeLessThan(2000 / speedup)
  expect(current.settleMax).toBeLessThan(3200 / speedup)
})

it('주사위가 서로를 눈에 보이게 파고들지 않는다', () => {
  const width = CONFIG.defaults.diceSize * SCENE.colliderHalfRatio * SCENE.bowlDiceScale * 2
  expect(current.stepW).toBeLessThan(0.34)
  expect(current.maxPen / width).toBeLessThan(0.25)
  expect(current.minY).toBeGreaterThanOrEqual(width / 2 - SCENE.safety.penetrationTolerance - 1e-6)
  expect(current.minBottomClearance).toBeGreaterThanOrEqual(
    -SCENE.safety.penetrationTolerance - 1e-6,
  )
})

it('사발 안에서 주사위가 바닥에 붙지 않고 떠서 구른다', () => {
  const bowlFloor =
    SCENE.bowl.colliderBottomY +
    SCENE.bowl.colliderBottomHalfHeight +
    CONFIG.defaults.diceSize * SCENE.colliderHalfRatio * SCENE.bowlDiceScale
  expect(current.bowlAlt).toBeGreaterThan(bowlFloor + 0.06)
  expect(current.bowlAltMin).toBeGreaterThanOrEqual(
    bowlFloor - SCENE.safety.penetrationTolerance - 1e-6,
  )
  expect(current.bowlBottomClearanceMin).toBeGreaterThanOrEqual(
    -SCENE.safety.penetrationTolerance - 1e-6,
  )
  expect(current.bowlAltMax).toBeLessThan(SCENE.bowl.colliderLidY + 0.3)
  expect(current.bowlSpin).toBeGreaterThan(1.8)
  expect(current.bowlSpin).toBeLessThan(3.5)
})

it('던져진 주사위가 과하게 튀지 않고 퍼진다', () => {
  expect(current.bounces).toBeGreaterThan(0.5)
  expect(current.bounces).toBeLessThan(1.5)
  expect(current.spread).toBeGreaterThan(1.3)
  expect(current.invalidTrajectories, current.invalidTrajectoryDetails.join(', ')).toBe(0)
  expect(current.turns).toBeGreaterThan(0.1)
  expect(current.turns).toBeLessThan(0.3)
})

it('정착하지 못한 굴림도 상한 안에서 끝난다', () => {
  const worstRoll = SCENE.bowl.tiltDurationMs + SCENE.bowl.spillPushDurationMs + current.settleMax
  expect(SCENE.settlement.maxRollDurationMs).toBeGreaterThan(SCENE.settlement.minRollDurationMs)
  expect(SCENE.settlement.maxRollDurationMs).toBeGreaterThan(worstRoll)
})
