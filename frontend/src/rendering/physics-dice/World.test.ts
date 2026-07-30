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
 * 이 티켓은 같은 증상("천천히 떨어짐 · 겹침 · 바닥에 붙어 있음")으로 여러 번 돌아왔다.
 * 최종 구조는 3단계다 — config.ts 상단 주석 참고:
 *
 * 1. 흔들기: 사발 입구를 보이지 않는 뚜껑으로 막고, 바닥 근처 주사위를 목표 높이
 *    √(2gh) 킥으로 세게 튀긴다. 임펄스 상수 방식은 중력을 올리면 홉 높이가 죽어서
 *    주사위가 바닥에 붙어 떠는 것처럼 보였다.
 * 2. 뒤집는 순간: 사발 물리 바디를 치우고(이후 사발은 비주얼) 측면으로 던진다.
 * 3. 비행·착지: 풀 중력(원본 × 12) 낙하. Max 반발 결합 + restitution 0.55로 튕기고,
 *    fan · randomZ로 퍼진다.
 *
 * 그래서 이 테스트는 값이 아니라 **움직임의 성질**을 잠근다. 수정 전(중력 30) 튜닝을
 * 같은 시드로 함께 돌려 기준선으로 삼는다:
 *
 * - `bowlAlt` · `bowlSpin` — 사발 안에서 실제로 떠서 구르는지("바닥에 붙음"의 회귀 감시).
 * - `bounces` · `spread`   — 던져진 뒤 튕기고 퍼지는지("미끄러져 처박힘"의 회귀 감시).
 * - `turns`                — 비행 중 총 회전수. 줄면 주사위가 구르지 않고 미끄러진다.
 * - `maxPen`               — 주사위끼리 실제 침투 깊이(narrow-phase). "겹침"의 실체.
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
  restitution: 0.34,
  spillLift: 0.4,
  spillFan: 0.22,
  spillRandomZ: 0.25,
  kickHeight: 1.25,
  kickAltitude: 0.55,
}

/** 주사위 콜라이더의 반발 결합 규칙 — false면 원본(Average) 재현. */
let RESTITUTION_MAX_RULE = true
/** true면 원본의 상수 임펄스 킥을 재현(기준선), false면 현재의 √(2gh) 높이 킥. */
let LEGACY_KICK = false
const LEGACY_LIFT_IMPULSE = 0.24

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
  if (o.shakeRandom !== undefined) bowl.shakeRandomImpulse = o.shakeRandom
  if (o.shakeCenter !== undefined) bowl.shakeCenterStrength = o.shakeCenter
  if (o.shakeOrbit !== undefined) bowl.shakeOrbitStrength = o.shakeOrbit
  if (o.shakeTorque !== undefined) bowl.shakeTorqueImpulse = o.shakeTorque
  if (o.shakeInterval !== undefined) bowl.shakeIntervalMs = o.shakeInterval
  if (o.settleLinear !== undefined) settle.linearSpeed = o.settleLinear
  if (o.settleAngular !== undefined) settle.angularSpeed = o.settleAngular
  if (o.stableFrames !== undefined) settle.stableFrames = o.stableFrames
  if (o.restitution !== undefined) d.restitution = o.restitution
  if (o.spillLift !== undefined) bowl.spillLiftSpeed = o.spillLift
  if (o.spillFan !== undefined) bowl.spillFanSpeed = o.spillFan
  if (o.spillRandomZ !== undefined) bowl.spillRandomZ = o.spillRandomZ
  if (o.kickHeight !== undefined) bowl.shakeKickHeight = o.kickHeight
  if (o.kickAltitude !== undefined) bowl.shakeKickAltitude = o.kickAltitude
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
    if (!RESTITUTION_MAX_RULE) {
      // 원본 기준선 재현용 — 지금 diceInstances는 항상 Max 규칙이다.
      entry.collider.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Average)
    }
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

  // 흔들기 1.2초 — World.updateBowl과 같은 킥 로직(바닥 근처만 √(2gh) 높이 킥)
  let bowlAngvelSum = 0
  let bowlSamples = 0
  let bowlAltSum = 0
  let bowlAltMax = 0
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
        const kickRandom = random.next()
        let kickY: number
        if (LEGACY_KICK) {
          kickY = LEGACY_LIFT_IMPULSE + kickRandom * SCENE.bowl.shakeRandomImpulse
        } else {
          const altitude = p.y - SCENE.bowl.hoverY
          kickY =
            altitude < SCENE.bowl.shakeKickAltitude
              ? Math.sqrt(
                  2 *
                    CONFIG.defaults.gravity *
                    SCENE.bowl.shakeKickHeight *
                    (0.3 + 0.7 * kickRandom),
                ) * mass
              : 0
        }
        entry.body.applyImpulse(
          {
            x:
              (bvx - v.x) * SCENE.bowl.shakeFollowStrength * mass +
              (x - p.x) * SCENE.bowl.shakeCenterStrength -
              (z - p.z) * SCENE.bowl.shakeOrbitStrength,
            y: kickY,
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
      const alt = entry.body.translation().y - SCENE.bowl.hoverY
      bowlAltSum += alt
      bowlAltMax = Math.max(bowlAltMax, alt)
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
  // 튕김 계측: 트레이에 닿은 뒤 vy가 하강 → 상승으로 뒤집히는 횟수와 그 바운스의 최고 높이
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
      apex = Math.max(apex, p.y - restY)
      const v = entry.body.linvel()
      maxSpeed = Math.max(maxSpeed, Math.hypot(v.x, v.y, v.z))
      // 낙하 중이던 주사위가 위로 튀어 오르면 바운스 1회
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
  // 퍼짐: 최종 위치의 쌍별 XZ 거리 평균 — 뭉쳐서 멈추면 작아진다
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
    escaped,
    bowlSpin: bowlAngvelSum / Math.max(1, bowlSamples),
    bowlAlt: bowlAltSum / Math.max(1, bowlSamples),
    bowlAltMax,
    maxRestY,
    bounces: bounceCount.reduce((s, n) => s + n, 0) / entries.length,
    bounceApex,
    spread: spreadSum / Math.max(1, spreadPairs),
  }
}

function measure(o: Overrides) {
  const before = override(o)
  const runs = SEEDS.map((seed) => simulate(seed))
  const hz = CONFIG.defaults.simulationHz
  const width = CONFIG.defaults.diceSize * SCENE.colliderHalfRatio * SCENE.bowlDiceScale * 2
  restore(before)
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
    stepW: Math.max(...runs.map((r) => r.maxSpeed)) / hz / width,
    bowlSpin: avg((r) => r.bowlSpin),
    bowlAlt: avg((r) => r.bowlAlt),
    bowlAltMax: Math.max(...runs.map((r) => r.bowlAltMax)),
    escaped: runs.filter((r) => r.escaped).length,
    stacked: runs.filter((r) => r.maxRestY > width).length,
    bounces: avg((r) => r.bounces),
    bounceApex: Math.max(...runs.map((r) => r.bounceApex)),
    spread: avg((r) => r.spread),
  }
}

/** 두 측정을 한 번만 돌려 모든 테스트가 함께 쓴다(각 24시드 × 5주사위). */
let current: ReturnType<typeof measure>
let original: ReturnType<typeof measure>

beforeAll(async () => {
  await RAPIER.init()
  RESTITUTION_MAX_RULE = true
  LEGACY_KICK = false
  current = measure(null)
  RESTITUTION_MAX_RULE = false
  LEGACY_KICK = true
  original = measure(ORIGINAL)
  RESTITUTION_MAX_RULE = true
  LEGACY_KICK = false
})

it('쏟은 주사위가 트레이 안에서 빠르게 안착한다', () => {
  expect(current.hangs).toBe(0)
  expect(current.escaped).toBe(0)
  // 수정 전에는 평균 1301ms · 최악 2633ms였다 — "천천히 떨어진다"의 실체.
  expect(current.settleAvg).toBeLessThan(700)
  expect(current.settleMax).toBeLessThan(1500)
  expect(current.settleAvg).toBeLessThan(original.settleAvg * 0.55)
})

it('주사위가 서로를 눈에 보이게 파고들지 않는다', () => {
  const width = CONFIG.defaults.diceSize * SCENE.colliderHalfRatio * SCENE.bowlDiceScale * 2
  // 한 스텝 이동량이 몸통의 1/3을 넘으면 접촉이 이미 깊이 파고든 뒤에 발견된다 —
  // gravity·throwForce를 올리면서 simulationHz를 안 올리면 여기서 걸린다.
  expect(current.stepW).toBeLessThan(0.34)
  // 수정 전에는 몸통 폭의 57%(0.284)까지 파고들었다.
  expect(current.maxPen / width).toBeLessThan(0.25)
})

it('사발 안에서 주사위가 바닥에 붙지 않고 떠서 구른다', () => {
  // "바닥에 쳐 붙어 있다"의 회귀 감시 — 평균 고도가 낮으면 주사위가 바닥에서 떨기만 한다.
  expect(current.bowlAlt).toBeGreaterThan(original.bowlAlt * 1.1)
  // 뚜껑 아래에 머문다 — 사발 위로 튀어나오면 안 된다.
  expect(current.bowlAltMax).toBeLessThan(SCENE.bowl.colliderLidY + 0.3)
  // 구르기도 원본 이상으로 활발해야 한다.
  expect(current.bowlSpin).toBeGreaterThan(original.bowlSpin * 0.8)
})

it('던져진 주사위가 튕기고 퍼진다', () => {
  // "던져져도 바닥에 붙어 있다"의 회귀 감시 — 원본(rest 0.34 · Average)보다 확실히 튀어야 한다.
  expect(current.bounces).toBeGreaterThan(1.5)
  // 다섯 개가 뭉치지 않고 퍼진다.
  expect(current.spread).toBeGreaterThan(1.3)
  // 비행 중 회전 — 줄면 주사위가 구르지 않고 미끄러진다.
  expect(current.turns).toBeGreaterThan(original.turns * 0.7)
})

it('정착하지 못한 굴림도 상한 안에서 끝난다', () => {
  // checkSettled는 minRollDurationMs 뒤부터 정착을 보고, 끝내 성립하지 않으면
  // maxRollDurationMs에서 강제로 정렬로 넘어간다(없으면 굴림이 영원히 끝나지 않는다).
  const worstRoll = SCENE.bowl.tiltDurationMs + SCENE.bowl.spillPushDurationMs + current.settleMax
  expect(SCENE.settlement.maxRollDurationMs).toBeGreaterThan(SCENE.settlement.minRollDurationMs)
  expect(SCENE.settlement.maxRollDurationMs).toBeGreaterThan(worstRoll)
})
