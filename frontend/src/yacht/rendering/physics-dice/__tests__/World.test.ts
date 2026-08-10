import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSizedContainer, FakeResizeObserver, FakeWebGLRenderer } from '@/test/threeStubs'
import { createBowl, createTray } from '@/yacht/rendering/physics-dice/arena'
import { PHYSICS_DICE_CONFIG } from '@/yacht/rendering/physics-dice/config'
import { createDiceInstances } from '@/yacht/rendering/physics-dice/diceInstances'
import {
  keepSlotPosition,
  keepSlotSpacing,
  resultCameraWidth,
} from '@/yacht/rendering/physics-dice/layout'
import { topFaceFromQuaternion } from '@/yacht/rendering/physics-dice/model'
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
import type {
  PhysicsDiceIndex,
  PhysicsDiceRollRequest,
  PhysicsDiceSet,
  PhysicsDiceWorldCallbacks,
  PhysicsHeldDice,
} from '@/yacht/rendering/physics-dice/types'
import { PhysicsDiceWorld } from '@/yacht/rendering/physics-dice/World'

vi.mock('three', async (importOriginal) => {
  const { threeWithFakeRenderer } = await import('@/test/threeStubs')
  return threeWithFakeRenderer(importOriginal)
})

const NONE_HELD: PhysicsHeldDice = [false, false, false, false, false]
const FRAME_MS = 16

function rollRequest(overrides: Partial<PhysicsDiceRollRequest> = {}): PhysicsDiceRollRequest {
  return {
    held: NONE_HELD,
    requestId: 'roll-1',
    seed: 20260730,
    targetDice: [6, 2, 5, 1, 4],
    ...overrides,
  }
}

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

describe('PhysicsDiceWorld', () => {
  const created: PhysicsDiceWorld[] = []

  function callbackSpies(): PhysicsDiceWorldCallbacks {
    return {
      onError: vi.fn(),
      onHeldToggle: vi.fn(),
      onPhaseChange: vi.fn(),
      onResizeChange: vi.fn(),
      onRollComplete: vi.fn(),
    }
  }

  function build(width = 900, height = 640, quality: 'eco' | 'balanced' | 'high' = 'balanced') {
    const { container, resizeTo } = createSizedContainer(width, height)
    const callbacks = callbackSpies()
    const world = new PhysicsDiceWorld({ callbacks, container, quality })
    created.push(world)
    return { callbacks, container, resizeTo, world }
  }

  async function boot(width?: number, height?: number, quality?: 'eco' | 'balanced' | 'high') {
    const harness = build(width, height, quality)
    await harness.world.init()
    return harness
  }

  function runFrames(count: number) {
    for (let frame = 0; frame < count; frame += 1) vi.advanceTimersByTime(FRAME_MS)
  }

  function runUntil(condition: () => boolean, frames = 900) {
    for (let frame = 0; frame < frames && !condition(); frame += 1) {
      vi.advanceTimersByTime(FRAME_MS)
    }
    return condition()
  }

  function renderer() {
    const fake = FakeWebGLRenderer.last
    if (!fake) throw new Error('렌더러가 만들어지지 않았습니다.')
    return fake
  }

  function camera() {
    const found = scene().children.find(
      (child): child is THREE.OrthographicCamera => child instanceof THREE.OrthographicCamera,
    )
    const rendered = renderer().renders.at(-1)?.camera
    if (rendered instanceof THREE.OrthographicCamera) return rendered
    if (found) return found
    throw new Error('카메라를 찾을 수 없습니다.')
  }

  function scene() {
    const rendered = renderer().renders.at(-1)?.scene
    if (!(rendered instanceof THREE.Scene)) throw new Error('장면을 찾을 수 없습니다.')
    return rendered
  }

  function diceMeshes() {
    return scene()
      .children.filter(
        (child): child is THREE.Group =>
          child instanceof THREE.Group && typeof child.userData.dieIndex === 'number',
      )
      .sort((a, b) => Number(a.userData.dieIndex) - Number(b.userData.dieIndex))
  }

  function topFaces() {
    return diceMeshes().map((mesh) => topFaceFromQuaternion(mesh.quaternion))
  }

  function keepSlotBars() {
    return scene()
      .children.filter(
        (child): child is THREE.Group =>
          child instanceof THREE.Group &&
          child.userData.dieIndex === undefined &&
          child.children.length === 1 &&
          child.children[0] instanceof THREE.Mesh,
      )
      .sort((a, b) => a.position.x - b.position.x)
      .map((group) => group.children[0] as THREE.Mesh)
  }

  function bowlGroup() {
    const group = scene().children.find(
      (child): child is THREE.Group =>
        child instanceof THREE.Group &&
        child.userData.dieIndex === undefined &&
        child.children.length >= 3,
    )
    if (!group) throw new Error('사발 그룹을 찾을 수 없습니다.')
    return group
  }

  function pointerEventAt(position: THREE.Vector3) {
    const ndc = position.clone().project(camera())
    return new MouseEvent('pointerup', {
      bubbles: true,
      clientX: ((ndc.x + 1) / 2) * renderer().width,
      clientY: ((1 - ndc.y) / 2) * renderer().height,
    })
  }

  beforeEach(() => {
    FakeWebGLRenderer.reset()
    FakeResizeObserver.reset()
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.stubGlobal('devicePixelRatio', 3)
    vi.useFakeTimers()
  })

  afterEach(() => {
    created.forEach((world) => {
      try {
        world.destroy()
      } catch {}
    })
    created.length = 0
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.replaceChildren()
    document.documentElement.removeAttribute('data-theme')
  })

  describe('초기화와 해제', () => {
    it('캔버스를 컨테이너에 붙이고 첫 프레임에 주사위 5개를 결과 줄에 세운다', async () => {
      const { container } = await boot()

      runFrames(1)

      expect(container.children).toHaveLength(1)
      expect(renderer().renders.length).toBeGreaterThan(0)
      const meshes = diceMeshes()
      expect(meshes).toHaveLength(5)
      meshes.forEach((mesh) => {
        expect(mesh.visible).toBe(true)
        expect(mesh.position.z).toBeCloseTo(SCENE.tray.resultRowZ, 5)
      })
      expect(meshes[2]?.position.x).toBeCloseTo(0, 5)
    })

    it('초기화 전에 받은 확정 주사위가 첫 프레임에 그대로 보인다', async () => {
      const dice: PhysicsDiceSet = [2, 4, 6, 1, 3]
      const { world } = build()

      world.syncCommittedDice(dice, NONE_HELD)
      await world.init()
      runFrames(1)

      expect(topFaces()).toEqual([...dice])
    })

    it('초기화 전 startRoll·applyQuality는 아무 일도 하지 않는다 — 지연 로딩 중 눌러도 안전하다', () => {
      const { callbacks, world } = build()

      expect(() => {
        world.applyQuality('high')
        world.startRoll(rollRequest())
        world.pour()
      }).not.toThrow()
      expect(callbacks.onPhaseChange).not.toHaveBeenCalled()
    })

    it('해제하면 컨테이너를 비우고 렌더러 컨텍스트를 놓고 프레임을 멈춘다', async () => {
      const { callbacks, container, world } = await boot()
      runFrames(2)
      const rendered = renderer().renders.length

      world.destroy()
      runFrames(10)

      expect(container.children).toHaveLength(0)
      expect(renderer().disposeCount).toBe(1)
      expect(renderer().contextLossCount).toBe(1)
      expect(renderer().renders.length).toBe(rendered)
      expect(callbacks.onResizeChange).toHaveBeenLastCalledWith(false)
    })

    it('초기화하지 않은 월드를 해제해도 예외가 없다', () => {
      const { world } = build()

      expect(() => world.destroy()).not.toThrow()
    })
  })

  describe('syncCommittedDice', () => {
    it('확정값을 바꾸면 굴리지 않고도 곧바로 그 눈이 보인다', async () => {
      const { world } = await boot()

      world.syncCommittedDice([1, 1, 3, 3, 5], NONE_HELD)
      runFrames(1)

      expect(topFaces()).toEqual([1, 1, 3, 3, 5])
    })

    it('킵을 켜면 킵 순서대로 슬롯까지 애니메이션으로 이동한다', async () => {
      const { world } = await boot()
      world.syncCommittedDice([1, 2, 3, 4, 5], NONE_HELD)
      runFrames(1)
      const before = diceMeshes()[2]?.position.clone() ?? new THREE.Vector3()

      world.syncCommittedDice(null, [false, false, true, false, false])
      runFrames(2)
      const midway = diceMeshes()[2]?.position.clone() ?? new THREE.Vector3()

      expect(midway.distanceTo(before)).toBeGreaterThan(0)
      expect(midway.x).toBeGreaterThan(keepSlotPosition(0).x)

      runFrames(SCENE.keepSlots.moveDurationMs / FRAME_MS + 4)

      expect(diceMeshes()[2]?.position.x).toBeCloseTo(keepSlotPosition(0).x, 4)
      expect(diceMeshes()[2]?.position.z).toBeGreaterThan(SCENE.tray.separatorZ)
    })

    it('킵 순서를 기억한다 — 먼저 킵한 주사위가 왼쪽 슬롯에 남는다', async () => {
      const { world } = await boot()

      world.syncCommittedDice([1, 2, 3, 4, 5], [false, false, false, true, false])
      world.syncCommittedDice(null, [true, false, false, true, false])
      runFrames(40)

      const meshes = diceMeshes()
      expect(meshes[3]?.position.x).toBeCloseTo(keepSlotPosition(0).x, 4)
      expect(meshes[0]?.position.x).toBeCloseTo(keepSlotPosition(1).x, 4)
    })

    it('킵을 풀면 그 주사위만 결과 줄로 돌아가고 남은 킵은 슬롯을 앞으로 당긴다', async () => {
      const { world } = await boot()
      world.syncCommittedDice([1, 2, 3, 4, 5], [true, false, true, false, false])
      runFrames(40)

      world.syncCommittedDice(null, [false, false, true, false, false])
      runFrames(40)

      const meshes = diceMeshes()
      expect(meshes[2]?.position.x).toBeCloseTo(keepSlotPosition(0).x, 4)
      expect(meshes[0]?.position.z).toBeCloseTo(SCENE.tray.resultRowZ, 4)
    })

    it('굴리는 중에는 배치를 바꾸지 않는다 — 사발 안 주사위가 갑자기 레일로 튀지 않는다', async () => {
      const { world } = await boot()
      world.startRoll(rollRequest())
      runFrames(3)
      const before = diceMeshes().map((mesh) => mesh.position.clone())

      world.syncCommittedDice([1, 1, 1, 1, 1], [true, true, false, false, false])

      const after = diceMeshes().map((mesh) => mesh.position.clone())
      after.forEach((position, index) => {
        expect(position.distanceTo(before[index] ?? new THREE.Vector3())).toBe(0)
      })
    })
  })

  describe('startRoll', () => {
    it('흔들기 단계로 들어가며 사발을 띄우고 주사위를 사발 안에 담는다', async () => {
      const { callbacks, world } = await boot()

      world.startRoll(rollRequest())
      runFrames(1)

      expect(callbacks.onPhaseChange).toHaveBeenCalledWith('shaking')
      expect(bowlGroup().visible).toBe(true)
      diceMeshes().forEach((mesh) => {
        const radius = Math.hypot(
          mesh.position.x - SCENE.bowl.startX,
          mesh.position.z - SCENE.bowl.startZ,
        )
        expect(radius).toBeLessThan(SCENE.bowl.containmentRadius)
        expect(mesh.position.y).toBeGreaterThan(SCENE.bowl.hoverY)
      })
    })

    it('같은 requestId를 다시 보내도 굴림을 다시 시작하지 않는다', async () => {
      const { callbacks, world } = await boot()
      const request = rollRequest()

      world.startRoll(request)
      runFrames(2)
      const positions = diceMeshes().map((mesh) => mesh.position.clone())
      world.startRoll(request)

      expect(callbacks.onPhaseChange).toHaveBeenCalledTimes(1)
      diceMeshes().forEach((mesh, index) => {
        expect(mesh.position.distanceTo(positions[index] ?? new THREE.Vector3())).toBe(0)
      })
    })

    it('킵한 주사위는 사발에 담지 않고 슬롯에 확정값으로 고정해 둔다', async () => {
      const { world } = await boot()
      world.syncCommittedDice([1, 2, 3, 4, 5], NONE_HELD)
      const held: PhysicsHeldDice = [false, true, false, false, true]

      world.startRoll(rollRequest({ held, targetDice: [6, 2, 6, 6, 5] }))
      runFrames(30)

      const meshes = diceMeshes()
      expect(meshes[1]?.position.x).toBeCloseTo(keepSlotPosition(0).x, 4)
      expect(meshes[4]?.position.x).toBeCloseTo(keepSlotPosition(1).x, 4)
      expect(topFaceFromQuaternion(meshes[1]?.quaternion ?? new THREE.Quaternion())).toBe(2)
      expect(topFaceFromQuaternion(meshes[4]?.quaternion ?? new THREE.Quaternion())).toBe(5)
    })

    it('같은 seed는 같은 스폰 배치를 만든다 — 재접속 후에도 같은 굴림을 재현할 수 있다', async () => {
      const first = await boot()
      first.world.startRoll(rollRequest())
      runFrames(1)
      const firstPositions = diceMeshes().map((mesh) => mesh.position.clone())

      const second = await boot()
      second.world.startRoll(rollRequest())
      runFrames(1)
      const secondPositions = diceMeshes().map((mesh) => mesh.position.clone())

      secondPositions.forEach((position, index) => {
        expect(position.distanceTo(firstPositions[index] ?? new THREE.Vector3())).toBeLessThan(1e-9)
      })
    })
  })

  describe('굴림 완료', () => {
    it('흔들기 → 쏟기 → 정렬을 거쳐 목표 눈으로 마무리한다', async () => {
      const { callbacks, world } = await boot()
      const request = rollRequest({ targetDice: [3, 6, 1, 4, 2] })

      world.startRoll(request)
      runFrames(30)
      world.pour()
      const finished = runUntil(
        () => (callbacks.onRollComplete as ReturnType<typeof vi.fn>).mock.calls.length > 0,
      )

      expect(finished).toBe(true)
      expect(callbacks.onPhaseChange).toHaveBeenNthCalledWith(1, 'shaking')
      expect(callbacks.onPhaseChange).toHaveBeenNthCalledWith(2, 'pouring')
      expect(callbacks.onPhaseChange).toHaveBeenNthCalledWith(3, 'aligning')
      expect(callbacks.onPhaseChange).toHaveBeenLastCalledWith('idle')
      expect(callbacks.onRollComplete).toHaveBeenCalledWith(request.requestId, [
        ...request.targetDice,
      ])
      expect(topFaces()).toEqual([...request.targetDice])
    })

    it('굴림이 끝나면 결과 줄에 서고 사발은 화면에서 사라진다', async () => {
      const { callbacks, world } = await boot()

      world.startRoll(rollRequest())
      runFrames(30)
      world.pour()
      runUntil(() => (callbacks.onRollComplete as ReturnType<typeof vi.fn>).mock.calls.length > 0)

      expect(bowlGroup().visible).toBe(false)
      diceMeshes().forEach((mesh) => {
        expect(mesh.position.z).toBeCloseTo(SCENE.tray.resultRowZ, 4)
        expect(Math.abs(mesh.position.x)).toBeLessThan(resultCameraWidth())
      })
    })

    it('keepAll에서 레일 바는 주사위가 도착한 뒤에 켜진다', async () => {
      const { callbacks, world } = await boot()
      const held: PhysicsHeldDice = [true, true, false, false, false]
      world.syncCommittedDice([6, 6, 2, 3, 5], held)
      world.setKeepAll(true)
      world.startRoll(rollRequest({ held, targetDice: [6, 6, 6, 6, 2] }))
      runFrames(30)
      world.pour()
      runUntil(() => (callbacks.onPhaseChange as ReturnType<typeof vi.fn>).mock.calls.length >= 3)

      const flying = keepSlotBars()
      expect(flying[0]?.material).not.toBe(flying[4]?.material)

      runUntil(() => (callbacks.onRollComplete as ReturnType<typeof vi.fn>).mock.calls.length > 0)

      const landed = keepSlotBars()
      expect(landed[4]?.material).toBe(landed[0]?.material)
    })

    it('굴림 결과가 확정값으로 남아 다시 동기화해도 눈이 바뀌지 않는다', async () => {
      const { callbacks, world } = await boot()
      const request = rollRequest({ requestId: 'roll-baked', targetDice: [5, 5, 2, 3, 6] })

      world.startRoll(request)
      runFrames(30)
      world.pour()
      runUntil(() => (callbacks.onRollComplete as ReturnType<typeof vi.fn>).mock.calls.length > 0)
      world.syncCommittedDice(null, NONE_HELD)
      runFrames(2)

      expect(topFaces()).toEqual([...request.targetDice])
    })

    it('굴림이 끝난 뒤에는 다음 requestId로 다시 굴릴 수 있다', async () => {
      const { callbacks, world } = await boot()
      world.startRoll(rollRequest({ requestId: 'roll-1' }))
      runFrames(30)
      world.pour()
      runUntil(() => (callbacks.onRollComplete as ReturnType<typeof vi.fn>).mock.calls.length > 0)

      world.startRoll(rollRequest({ requestId: 'roll-2', seed: 99, targetDice: [1, 1, 1, 1, 1] }))
      runFrames(30)
      world.pour()
      const finished = runUntil(
        () => (callbacks.onRollComplete as ReturnType<typeof vi.fn>).mock.calls.length > 1,
      )

      expect(finished).toBe(true)
      expect(topFaces()).toEqual([1, 1, 1, 1, 1])
    })

    it('pour는 흔들기 중에만 듣는다 — idle에서 눌러도 굴림이 시작되지 않는다', async () => {
      const { callbacks, world } = await boot()

      world.pour()
      runFrames(5)

      expect(callbacks.onPhaseChange).not.toHaveBeenCalled()
      expect(callbacks.onRollComplete).not.toHaveBeenCalled()
    })
  })

  describe('흔들림 펄스', () => {
    it('follow 모드가 아니면 펄스를 무시한다 — tap 모드는 자체 리듬으로 흔든다', async () => {
      const { world } = await boot()
      world.startRoll(rollRequest())
      runFrames(2)
      const before = diceMeshes().map((mesh) => mesh.position.clone())

      world.applyShakePulse('left', 1)

      diceMeshes().forEach((mesh, index) => {
        expect(mesh.position.distanceTo(before[index] ?? new THREE.Vector3())).toBe(0)
      })
    })

    it('follow 모드에서는 펄스가 없으면 사발이 잦아들고, 펄스를 주면 다시 흔들린다', async () => {
      const { world } = await boot()
      world.setMotionFollow(true)
      world.startRoll(rollRequest())

      runFrames(120)
      const quiet = bowlGroup().position.clone()

      world.applyShakePulse('right', 1)
      runFrames(3)

      expect(quiet.x).toBeCloseTo(SCENE.bowl.startX, 4)
      expect(quiet.z).toBeCloseTo(SCENE.bowl.startZ, 4)
      expect(bowlGroup().position.distanceTo(quiet)).toBeGreaterThan(0)
    })

    it('펄스는 굴릴 주사위만 움직이고 킵한 주사위는 슬롯에 붙어 있다', async () => {
      const { world } = await boot()
      world.setMotionFollow(true)
      const held: PhysicsHeldDice = [true, false, false, false, false]
      world.startRoll(rollRequest({ held }))
      runFrames(2)
      const heldBefore = diceMeshes()[0]?.position.clone() ?? new THREE.Vector3()
      const rollingBefore = diceMeshes()[1]?.position.clone() ?? new THREE.Vector3()

      world.applyShakePulse('left', 1)
      runFrames(4)

      expect(diceMeshes()[0]?.position.distanceTo(heldBefore)).toBe(0)
      expect(diceMeshes()[1]?.position.distanceTo(rollingBefore)).toBeGreaterThan(0)
    })

    it('흔들기 단계가 아니면 펄스를 무시한다 — idle에서 흔들어도 사발이 나오지 않는다', async () => {
      const { world } = await boot()
      runFrames(1)
      world.setMotionFollow(true)

      expect(() => world.applyShakePulse('left', 2)).not.toThrow()
      expect(bowlGroup().visible).toBe(false)
    })
  })

  describe('applyQuality', () => {
    it('eco는 그림자를 끄고 픽셀 비율을 1로 낮춘다', async () => {
      const { world } = await boot()

      world.applyQuality('eco')

      expect(renderer().shadowMap.enabled).toBe(false)
      expect(renderer().pixelRatio).toBe(PHYSICS_DICE_CONFIG.quality.eco.pixelRatio)
    })

    it('품질을 올려도 기기 픽셀 비율 상한을 넘지 않는다 — 고DPI에서 GPU가 타지 않게', async () => {
      const { world } = await boot(900, 640, 'eco')

      world.applyQuality('high')

      expect(renderer().shadowMap.enabled).toBe(true)
      expect(renderer().pixelRatio).toBe(PHYSICS_DICE_CONFIG.quality.high.pixelRatio)
      expect(renderer().pixelRatio).toBeLessThan(window.devicePixelRatio)
    })

    it('품질을 낮추면 픽셀 비율도 함께 내려간다', async () => {
      const { world } = await boot(900, 640, 'high')

      world.applyQuality('balanced')

      expect(renderer().pixelRatio).toBe(PHYSICS_DICE_CONFIG.quality.balanced.pixelRatio)
    })

    it('품질을 바꿔도 화면 크기와 카메라는 유지된다', async () => {
      const { world } = await boot(900, 640)
      const before = { height: renderer().height, width: renderer().width }

      world.applyQuality('eco')

      expect(renderer().width).toBe(before.width)
      expect(renderer().height).toBe(before.height)
    })
  })

  describe('resize', () => {
    it('어떤 비율에서도 화면 픽셀이 정사각이다 — 주사위가 찌그러지지 않는다', async () => {
      const { resizeTo, world } = await boot(900, 640)

      for (const [width, height] of [
        [1600, 600],
        [700, 900],
        [240, 900],
      ] as const) {
        resizeTo(width, height)
        world.resize()
        runFrames(1)

        expect(camera().right / camera().top).toBeCloseTo(width / height, 5)
        expect(camera().left).toBeCloseTo(-camera().right, 6)
        expect(camera().bottom).toBeCloseTo(-camera().top, 6)
      }
    })

    it('아주 좁은 화면에서도 킵 슬롯 5개가 화면 안에 들어온다', async () => {
      const { resizeTo, world } = await boot(900, 640)
      const outerSlotEdge =
        2 * keepSlotSpacing() +
        (PHYSICS_DICE_CONFIG.defaults.diceSize * SCENE.keepSlots.diceScale) / 2

      resizeTo(240, 900)
      world.resize()
      runFrames(1)

      expect(camera().right).toBeGreaterThanOrEqual(outerSlotEdge)
    })

    it('세로로 긴 화면은 빈 바닥을 늘리는 대신 좌우 가장자리를 잘라낸다', async () => {
      const { resizeTo, world } = await boot(900, 640)

      resizeTo(700, 900)
      world.resize()
      runFrames(1)

      expect(camera().top).toBeCloseTo(SCENE.camera.maxHalfHeight, 6)
      expect(camera().right).toBeLessThan(resultCameraWidth())
    })

    it('가로로 넓은 화면은 세로를 최소 높이로 유지하고 좌우로만 넓힌다', async () => {
      const { resizeTo, world } = await boot(900, 640)

      resizeTo(1600, 600)
      world.resize()
      runFrames(1)

      expect(camera().top).toBeCloseTo(SCENE.camera.minHalfHeight, 6)
      expect(camera().right).toBeGreaterThan(resultCameraWidth())
    })

    it('렌더 해상도는 컨테이너 크기를 따라간다', async () => {
      const { resizeTo, world } = await boot(900, 640)

      resizeTo(1024, 768)
      world.resize()

      expect(renderer().width).toBe(1024)
      expect(renderer().height).toBe(768)
    })
  })

  describe('컨테이너 크기 변화 대응', () => {
    it('배너가 들어오는 정도의 작은 변화는 멈춤 없이 즉시 반영한다', async () => {
      const { callbacks, resizeTo } = await boot(900, 640)

      resizeTo(900, 560)
      FakeResizeObserver.emitAll()
      runFrames(1)

      expect(callbacks.onResizeChange).not.toHaveBeenCalledWith(true)
      expect(renderer().height).toBe(560)
    })

    it('회전처럼 큰 변화는 "조정 중"을 켜고 잦아든 뒤 한 번에 다시 맞춘다', async () => {
      const { callbacks, resizeTo } = await boot(900, 640)

      resizeTo(500, 1000)
      FakeResizeObserver.emitAll()

      expect(callbacks.onResizeChange).toHaveBeenCalledWith(true)
      expect(renderer().width).toBe(900)

      vi.advanceTimersByTime(200)

      expect(renderer().width).toBe(500)
      expect(callbacks.onResizeChange).toHaveBeenLastCalledWith(false)
    })

    it('큰 변화가 연달아 오면 마지막 크기로 한 번만 다시 맞춘다', async () => {
      const { callbacks, resizeTo } = await boot(900, 640)

      resizeTo(500, 1000)
      FakeResizeObserver.emitAll()
      vi.advanceTimersByTime(100)
      resizeTo(420, 1000)
      FakeResizeObserver.emitAll()
      vi.advanceTimersByTime(200)

      expect(renderer().width).toBe(420)
      expect(callbacks.onResizeChange).toHaveBeenLastCalledWith(false)
      expect(
        (callbacks.onResizeChange as ReturnType<typeof vi.fn>).mock.calls.filter(
          ([resizing]) => resizing === false,
        ),
      ).toHaveLength(1)
    })

    it('크기가 그대로면 아무 일도 하지 않는다', async () => {
      const { callbacks } = await boot(900, 640)
      runFrames(2)
      const rendered = renderer().renders.length

      FakeResizeObserver.emitAll()
      runFrames(1)

      expect(callbacks.onResizeChange).not.toHaveBeenCalled()
      expect(renderer().renders.length).toBe(rendered)
    })

    it('해제한 뒤 오는 크기 변화 통지는 무시한다', async () => {
      const { callbacks, resizeTo, world } = await boot(900, 640)
      world.destroy()
      ;(callbacks.onResizeChange as ReturnType<typeof vi.fn>).mockClear()

      resizeTo(400, 1000)
      FakeResizeObserver.emitAll()
      vi.advanceTimersByTime(300)

      expect(callbacks.onResizeChange).not.toHaveBeenCalled()
    })
  })

  describe('주사위 탭', () => {
    it('주사위를 탭하면 그 인덱스로 킵 토글을 알린다', async () => {
      const { callbacks } = await boot()
      runFrames(1)
      const meshes = diceMeshes()

      meshes.forEach((mesh) => {
        renderer().domElement.dispatchEvent(pointerEventAt(mesh.position))
      })

      expect(
        (callbacks.onHeldToggle as ReturnType<typeof vi.fn>).mock.calls.map(([index]) => index),
      ).toEqual([0, 1, 2, 3, 4] satisfies PhysicsDiceIndex[])
    })

    it('빈 곳을 탭하면 아무 것도 토글하지 않는다', async () => {
      const { callbacks } = await boot()
      runFrames(1)

      renderer().domElement.dispatchEvent(
        pointerEventAt(new THREE.Vector3(0, 0.5, SCENE.tray.rollingMinZ)),
      )

      expect(callbacks.onHeldToggle).not.toHaveBeenCalled()
    })

    it('굴리는 중에는 탭을 받지 않는다 — 사발 안 주사위를 킵할 수는 없다', async () => {
      const { callbacks, world } = await boot()
      runFrames(1)
      const positions = diceMeshes().map((mesh) => mesh.position.clone())

      world.startRoll(rollRequest())
      runFrames(1)
      positions.forEach((position) => {
        renderer().domElement.dispatchEvent(pointerEventAt(position))
      })

      expect(callbacks.onHeldToggle).not.toHaveBeenCalled()
    })

    it('해제한 뒤 캔버스에 남은 탭 이벤트는 콜백을 부르지 않는다', async () => {
      const { callbacks, world } = await boot()
      runFrames(1)
      const target = diceMeshes()[0]?.position.clone() ?? new THREE.Vector3()
      const event = pointerEventAt(target)

      world.destroy()
      renderer().domElement.dispatchEvent(event)

      expect(callbacks.onHeldToggle).not.toHaveBeenCalled()
    })
  })

  describe('테마 변경', () => {
    it('문서 테마 속성이 바뀌면 색을 다시 읽어 한 프레임 더 그린다', async () => {
      await boot()
      runFrames(2)
      const rendered = renderer().renders.length

      document.documentElement.setAttribute('data-theme', 'dark')
      await vi.advanceTimersByTimeAsync(FRAME_MS * 2)

      expect(renderer().renders.length).toBeGreaterThan(rendered)
    })
  })
})
