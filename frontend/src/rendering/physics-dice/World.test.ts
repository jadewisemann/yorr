import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { beforeAll, expect, it } from 'vitest'
import { createBowl, createTray } from './arena'
import { PHYSICS_DICE_CONFIG } from './config'
import { createDiceInstances } from './diceInstances'
import { createPhysicsDiceRandom } from './random'
import { isBodySettled } from './remap'
import { containDiceInBowl, containDiceInTray } from './safety'
import type { PhysicsHeldDice } from './types'

/**
 * 주사위 물리 회귀 테스트(S15P11A406-129).
 *
 * 이 티켓은 같은 증상으로 두 번 돌아왔다. 첫 시도는 중력만 18 → 30, 두 번째는 30 → 360으로
 * 올렸는데 **속도·각속도·감쇠를 함께 올리지 않아** 물리 닮음이 깨졌다. 그래서 낙하는 빨라졌지만
 * 비행 중 회전이 0.71 → 0.35바퀴, 사발 안 회전 속도가 3.5 → 0.5로 죽어서 주사위가 구르지 않고
 * 미끄러지듯 처박혔다("하나도 안 자연스러워").
 *
 * 그래서 이 테스트는 값이 아니라 **움직임의 모양**을 잠근다. 수정 전(중력 30) 튜닝을 기준선으로
 * 같은 시드로 함께 돌려서, 현재 설정이 "같은 움직임을 빠르게 재생"인지 비율로 확인한다:
 *
 * - `turns`    — 비행 중 총 회전수. 이게 줄면 주사위가 미끄러진다.
 * - `bowlSpin` — 사발 안 평균 각속도. 이게 줄면 주사위가 사발 바닥에 눌려 안 구른다.
 * - `apex` · `travel` — 궤적의 높이·거리.
 * - `maxPen`   — 주사위끼리 실제 침투 깊이(narrow-phase). "겹침"의 실체.
 *
 * 값을 여기 복제하면 config를 바꿔도 통과해버리므로 현재 값은 전부 config에서 읽는다.
 */
const CONFIG = PHYSICS_DICE_CONFIG
const SCENE = CONFIG.scene
const NO_HELD: PhysicsHeldDice = [false, false, false, false, false]
const SEEDS = Array.from({ length: 24 }, (_, i) => 7 + i * 9173)
const RENDER_HZ = 60

/** 수정 전(중력 30) 튜닝 — 느렸지만 움직임 자체는 자연스러웠던 기준선 */
const ORIGINAL = {
  gravity: 30,
  hz: 60,
  throwForce: 4.2,
  linearDamping: 0.16,
  angularDamping: 0.2,
  spillTorque: 0.9,
  shakeLift: 0.24,
  shakeRandom: 0.06,
  shakeCenter: 0.025,
  shakeOrbit: 0.075,
  shakeTorque: 0.55,
  shakeInterval: 105,
  settleLinear: 0.13,
  settleAngular: 0.18,
  stableFrames: 14,
  spawnLinear: 3,
  spawnLift: 2,
  spawnAngular: 19,
  softCcd: 0,
}

type Overrides = Partial<typeof ORIGINAL> | null
type NumberMap = Record<string, number>

/** config는 `as const`지만 런타임에는 평범한 객체다 — 기준선 비교를 위해 잠시 바꿔 쓴다. */
interface MutableConfig {
  defaults: NumberMap
  scene: { bowl: NumberMap; settlement: NumberMap }
}

const MUTABLE = PHYSICS_DICE_CONFIG as unknown as MutableConfig

function override(o: Overrides) {
  if (!o) return null
  const d = MUTABLE.defaults
  const bowl = MUTABLE.scene.bowl
  const settle = MUTABLE.scene.settlement
  const before = {
    d: { ...d },
    bowl: { ...bowl },
    settle: { ...settle },
  }
  if (o.gravity !== undefined) d.gravity = o.gravity
  if (o.hz !== undefined) d.simulationHz = o.hz
  if (o.throwForce !== undefined) d.throwForce = o.throwForce
  if (o.linearDamping !== undefined) d.linearDamping = o.linearDamping
  if (o.angularDamping !== undefined) d.angularDamping = o.angularDamping
  if (o.softCcd !== undefined) d.softCcdPrediction = o.softCcd
  if (o.spawnLinear !== undefined) d.spawnLinearSpeed = o.spawnLinear
  if (o.spawnLift !== undefined) d.spawnLiftSpeed = o.spawnLift
  if (o.spawnAngular !== undefined) d.spawnAngularSpeed = o.spawnAngular
  if (o.spillTorque !== undefined) bowl.spillTorque = o.spillTorque
  if (o.shakeLift !== undefined) bowl.shakeLiftImpulse = o.shakeLift
  if (o.shakeRandom !== undefined) bowl.shakeRandomImpulse = o.shakeRandom
  if (o.shakeCenter !== undefined) bowl.shakeCenterStrength = o.shakeCenter
  if (o.shakeOrbit !== undefined) bowl.shakeOrbitStrength = o.shakeOrbit
  if (o.shakeTorque !== undefined) bowl.shakeTorqueImpulse = o.shakeTorque
  if (o.shakeInterval !== undefined) bowl.shakeIntervalMs = o.shakeInterval
  if (o.settleLinear !== undefined) settle.linearSpeed = o.settleLinear
  if (o.settleAngular !== undefined) settle.angularSpeed = o.settleAngular
  if (o.stableFrames !== undefined) settle.stableFrames = o.stableFrames
  return before
}

function restore(before: ReturnType<typeof override>) {
  if (!before) return
  Object.assign(MUTABLE.defaults, before.d)
  Object.assign(MUTABLE.scene.bowl, before.bowl)
  Object.assign(MUTABLE.scene.settlement, before.settle)
}

/** World의 shaking → pour → releaseFromBowl → checkSettled를 렌더러 없이 그대로 재현한다. */
function simulate(seed: number) {
  const scene = new THREE.Scene()
  const world = new RAPIER.World({ x: 0, y: -CONFIG.defaults.gravity, z: 0 })
  world.timestep = 1 / CONFIG.defaults.simulationHz
  createTray(scene, world)
  const { bowlBody } = createBowl(scene, world)
  const { entries } = createDiceInstances(scene, world)
  const random = createPhysicsDiceRandom(seed)
  const half = CONFIG.defaults.diceSize * SCENE.colliderHalfRatio * SCENE.bowlDiceScale
  // World.frame은 렌더 프레임마다 checkSettled를 부른다 — 서브스텝마다가 아니다.
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

  // 흔들기 1.2초 — 사발 연출 주기는 config 그대로, 임펄스 주입은 shakeIntervalMs 그대로
  let bowlAngvelSum = 0
  let bowlSamples = 0
  let lastKick = -1e9
  const shakeSteps = Math.round(1.2 * CONFIG.defaults.simulationHz)
  for (let step = 0; step < shakeSteps; step += 1) {
    const timeMs = (step / CONFIG.defaults.simulationHz) * 1000
    const elapsed = timeMs / 1000
    const x = SCENE.bowl.startX + Math.sin(elapsed * 15) * SCENE.bowl.shakeOffsetX
    const z = SCENE.bowl.startZ + Math.sin(elapsed * 19 + 0.8) * SCENE.bowl.shakeOffsetZ
    const bvx = Math.cos(elapsed * 15) * 15 * SCENE.bowl.shakeOffsetX
    const bvz = Math.cos(elapsed * 19 + 0.8) * 19 * SCENE.bowl.shakeOffsetZ
    bowlBody.setNextKinematicTranslation({ x, y: SCENE.bowl.hoverY, z })
    if (timeMs - lastKick >= SCENE.bowl.shakeIntervalMs) {
      lastKick = timeMs
      const mass = CONFIG.defaults.mass
      entries.forEach((entry) => {
        const p = entry.body.translation()
        const v = entry.body.linvel()
        entry.body.applyImpulse(
          {
            x:
              (bvx - v.x) * SCENE.bowl.shakeFollowStrength * mass +
              (x - p.x) * SCENE.bowl.shakeCenterStrength -
              (z - p.z) * SCENE.bowl.shakeOrbitStrength,
            y: SCENE.bowl.shakeLiftImpulse + random.next() * SCENE.bowl.shakeRandomImpulse,
            z:
              (bvz - v.z) * SCENE.bowl.shakeFollowStrength * mass +
              (z - p.z) * SCENE.bowl.shakeCenterStrength +
              (x - p.x) * SCENE.bowl.shakeOrbitStrength,
          },
          true,
        )
        const torque = SCENE.bowl.shakeTorqueImpulse
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
    }
  }

  bowlBody.setTranslation({ x: 10, y: -5, z: 0 }, true)
  const force = CONFIG.defaults.throwForce
  entries.forEach((entry, index) => {
    entry.enteredTray = false
    const fan = index - (entries.length - 1) / 2
    const v = entry.body.linvel()
    const targetX =
      (SCENE.bowl.spillMinimumSpeed + random.next() * SCENE.bowl.spillRandomSpeed) *
      force *
      SCENE.bowl.spillForceMultiplier *
      SCENE.bowl.spillDirectionX
    entry.body.setLinvel(
      {
        x: Math.min(v.x * 0.7, targetX),
        y: Math.max(v.y * 0.7, SCENE.bowl.spillLiftSpeed * force),
        z:
          v.z * 0.65 +
          fan * SCENE.bowl.spillFanSpeed * force +
          (random.next() - 0.5) * SCENE.bowl.spillRandomZ,
      },
      true,
    )
    entry.body.applyImpulse(
      {
        x:
          (SCENE.bowl.spillSideImpulse +
            (random.next() - 0.5) * SCENE.bowl.spillSideImpulseVariance) *
          CONFIG.defaults.mass *
          force *
          SCENE.bowl.spillDirectionX,
        y: 0,
        z: 0,
      },
      true,
    )
    entry.body.applyTorqueImpulse(
      {
        x: (random.next() - 0.5) * SCENE.bowl.spillTorque,
        y: (random.next() - 0.5) * SCENE.bowl.spillTorque,
        z: (random.next() - 0.5) * SCENE.bowl.spillTorque,
      },
      true,
    )
  })

  let rotation = 0
  let apex = 0
  let travel = 0
  let maxPen = 0
  let maxSpeed = 0
  let stableFrames = 0
  let settledMs: number | null = null
  const restY = CONFIG.defaults.diceSize * SCENE.bowlDiceScale * 0.5
  const startX = entries.map((e) => e.body.translation().x)
  const maxSteps = Math.round(30 * CONFIG.defaults.simulationHz)

  for (let step = 0; step < maxSteps; step += 1) {
    world.step()
    containDiceInTray(entries)
    for (const entry of entries) {
      const a = entry.body.angvel()
      rotation += Math.hypot(a.x, a.y, a.z) * world.timestep
      const p = entry.body.translation()
      apex = Math.max(apex, p.y - restY)
      const v = entry.body.linvel()
      maxSpeed = Math.max(maxSpeed, Math.hypot(v.x, v.y, v.z))
    }
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
    // 렌더 프레임 경계에서만 정착을 본다 — World.checkSettled와 같은 빈도
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
  world.free()

  return {
    settledMs,
    turns: rotation / (2 * Math.PI) / entries.length,
    apex,
    travel: travel / entries.length,
    maxPen,
    maxSpeed,
    escaped,
    bowlSpin: bowlAngvelSum / Math.max(1, bowlSamples),
    maxRestY,
  }
}

function measure(name: string, o: Overrides) {
  const before = override(o)
  const runs = SEEDS.map((seed) => simulate(seed))
  const hz = CONFIG.defaults.simulationHz
  const width = CONFIG.defaults.diceSize * SCENE.colliderHalfRatio * SCENE.bowlDiceScale * 2
  restore(before)
  const avg = (pick: (r: (typeof runs)[0]) => number) =>
    runs.reduce((s, r) => s + pick(r), 0) / runs.length
  const settled = runs.filter((r) => r.settledMs !== null).map((r) => r.settledMs as number)
  return {
    name,
    settleAvg: Math.round(settled.reduce((a, b) => a + b, 0) / Math.max(1, settled.length)),
    settleMax: settled.length ? Math.max(...settled) : -1,
    hangs: runs.length - settled.length,
    turns: avg((r) => r.turns),
    apex: avg((r) => r.apex),
    travel: avg((r) => r.travel),
    maxPen: Math.max(...runs.map((r) => r.maxPen)),
    stepW: Math.max(...runs.map((r) => r.maxSpeed)) / hz / width,
    bowlSpin: avg((r) => r.bowlSpin),
    escaped: runs.filter((r) => r.escaped).length,
    stacked: runs.filter((r) => r.maxRestY > width).length,
  }
}

beforeAll(async () => {
  await RAPIER.init()
})

/** 두 측정을 한 번만 돌려 세 테스트가 함께 쓴다(각 24시드 × 5주사위). */
let current: ReturnType<typeof measure>
let original: ReturnType<typeof measure>

beforeAll(() => {
  current = measure('현재 config', null)
  original = measure('원본 g=30', ORIGINAL)
})

it('쏟은 주사위가 트레이 안에서 빠르게 안착한다', () => {
  expect(current.hangs).toBe(0)
  expect(current.escaped).toBe(0)
  // 다른 주사위 위에 올라탄 채 끝나지 않는다.
  expect(current.stacked).toBe(0)
  // 수정 전에는 평균 1301ms · 최악 2633ms였다 — "천천히 떨어진다"의 실체.
  expect(current.settleAvg).toBeLessThan(600)
  expect(current.settleMax).toBeLessThan(1200)
  // 원본보다 확실히 빨라야 이 티켓이 해결된 것이다.
  expect(current.settleAvg).toBeLessThan(original.settleAvg * 0.5)
})

it('주사위가 서로를 눈에 보이게 파고들지 않는다', () => {
  const width = CONFIG.defaults.diceSize * SCENE.colliderHalfRatio * SCENE.bowlDiceScale * 2
  // 한 스텝 이동량이 몸통의 1/3을 넘으면 접촉이 이미 깊이 파고든 뒤에 발견된다 —
  // gravity·throwForce를 올리면서 simulationHz를 안 올리면 여기서 걸린다.
  expect(current.stepW).toBeLessThan(0.34)
  // 수정 전에는 몸통 폭의 57%(0.284)까지 파고들었다.
  expect(current.maxPen / width).toBeLessThan(0.2)
  expect(current.maxPen).toBeLessThan(original.maxPen * 0.6)
})

it('빨라지기만 하고 움직임의 모양은 원본과 같다', () => {
  // 이 테스트가 이 티켓의 핵심이다. 중력만 올려 닮음을 깨면 낙하는 빨라지지만
  // 아래 비율이 무너진다(1차 커밋 실측: turns 49% · bowlSpin 14%).
  const ratio = {
    turns: current.turns / original.turns,
    bowlSpin: current.bowlSpin / original.bowlSpin,
    apex: current.apex / original.apex,
    travel: current.travel / original.travel,
  }
  // 비행 중 회전수 — 줄면 주사위가 구르지 않고 미끄러진다.
  expect(ratio.turns).toBeGreaterThan(0.7)
  // 사발 안 회전 — 줄면 주사위가 바닥에 눌려 흔들어도 안 구른다.
  expect(ratio.bowlSpin).toBeGreaterThan(0.7)
  // 궤적 높이·거리는 원본에서 크게 벗어나면 안 된다(너무 낮으면 처박히고, 너무 멀면 미끄러진다).
  expect(ratio.apex).toBeGreaterThan(0.75)
  expect(ratio.apex).toBeLessThan(1.35)
  expect(ratio.travel).toBeGreaterThan(0.75)
  expect(ratio.travel).toBeLessThan(1.35)
})

it('정착하지 못한 굴림도 상한 안에서 끝난다', () => {
  // checkSettled는 minRollDurationMs 뒤부터 정착을 보고, 끝내 성립하지 않으면
  // maxRollDurationMs에서 강제로 정렬로 넘어간다(없으면 굴림이 영원히 끝나지 않는다).
  const worstRoll = SCENE.bowl.tiltDurationMs + SCENE.bowl.spillPushDurationMs + current.settleMax
  expect(SCENE.settlement.maxRollDurationMs).toBeGreaterThan(SCENE.settlement.minRollDurationMs)
  expect(SCENE.settlement.maxRollDurationMs).toBeGreaterThan(worstRoll)
})
