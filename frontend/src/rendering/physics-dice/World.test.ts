import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { beforeAll, expect, it } from 'vitest'
import { createBowl, createTray } from './arena'
import { PHYSICS_DICE_CONFIG } from './config'
import { createDiceInstances } from './diceInstances'
import { createPhysicsDiceRandom } from './random'
import { isBodySettled } from './remap'
import type { DieEntry } from './runtimeTypes'
import { containDiceInBowl, containDiceInTray } from './safety'
import type { PhysicsHeldDice } from './types'

/**
 * 주사위 물리 회귀 테스트(S15P11A406-129).
 *
 * `gravity` · `simulationHz` · `throwForce`는 서로 짝이 맞아야 하는 값이라 하나만 만지면
 * 티켓의 증상이 다시 나온다. 이전 수정(S15P11A406-94)이 중력만 18 → 30으로 올리고 스텝 주기를
 * 그대로 둬서 증상이 남았기 때문에, 값 하나가 아니라 **관계**를 잠근다:
 *
 * 1. **겹침·관통** — 한 스텝에 주사위가 자기 몸통의 몇 할을 지나가는지가 관통 깊이를 정한다.
 *    60Hz · 중력 30에서는 몸통의 53%를 한 스텝에 지나가 주사위끼리 몸통 폭의 57%까지 파고들었다.
 * 2. **천천히 떨어짐** — 쏟은 뒤 정착까지 걸리는 시간(수정 전 평균 1283ms).
 * 3. **굴림이 안 끝남** — 중력만 올린 조합에서는 한 굴림이 12.6초까지 튀었다. 상한이 있어야 한다.
 *
 * 값을 여기 복제하면 config를 바꿔도 통과해버리므로 전부 config에서 읽는다.
 */
const CONFIG = PHYSICS_DICE_CONFIG
const SCENE = CONFIG.scene
const NO_HELD: PhysicsHeldDice = [false, false, false, false, false]
const SEEDS = [7, 9180, 18353, 27526, 36699, 45872, 55045, 64218, 73391, 82564, 91737, 100910]
const DIE_HALF = CONFIG.defaults.diceSize * SCENE.colliderHalfRatio * SCENE.bowlDiceScale
const DIE_WIDTH = DIE_HALF * 2

/** 주사위끼리의 실제 침투 깊이(narrow-phase). 회전한 큐브라 AABB 근사는 크게 과대평가한다. */
function dicePenetration(world: RAPIER.World, entries: DieEntry[]) {
  let worst = 0
  for (let a = 0; a < entries.length; a += 1) {
    for (let b = a + 1; b < entries.length; b += 1) {
      const first = entries[a]?.collider
      const second = entries[b]?.collider
      if (!first || !second) continue
      world.contactPair(first, second, (manifold) => {
        for (let index = 0; index < manifold.numContacts(); index += 1) {
          const dist = manifold.contactDist(index)
          if (dist < 0) worst = Math.max(worst, -dist)
        }
      })
    }
  }
  return worst
}

/** World의 startRoll → releaseFromBowl 물리 경로를 렌더러 없이 그대로 재현한다. */
function simulateRoll(seed: number) {
  const scene = new THREE.Scene()
  const world = new RAPIER.World({ x: 0, y: -CONFIG.defaults.gravity, z: 0 })
  world.timestep = 1 / CONFIG.defaults.simulationHz
  createTray(scene, world)
  const { bowlBody } = createBowl(scene, world)
  const { entries } = createDiceInstances(scene, world)
  const random = createPhysicsDiceRandom(seed)

  bowlBody.setTranslation(
    { x: SCENE.bowl.startX, y: SCENE.bowl.hoverY, z: SCENE.bowl.startZ },
    true,
  )
  entries.forEach((entry) => {
    entry.collider.setShape(new RAPIER.Cuboid(DIE_HALF, DIE_HALF, DIE_HALF))
    const angle = (entry.index / entries.length) * Math.PI * 2 - Math.PI / 2
    const radius = SCENE.bowl.spawnRadius + (random.next() - 0.5) * SCENE.bowl.spawnJitter
    entry.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
    entry.body.setTranslation(
      {
        x: SCENE.bowl.startX + Math.cos(angle) * radius,
        y: SCENE.bowl.hoverY + SCENE.bowl.spawnBaseY + random.next() * SCENE.bowl.spawnRangeY,
        z: SCENE.bowl.startZ + Math.sin(angle) * radius,
      },
      true,
    )
    entry.body.setLinvel(
      { x: (random.next() - 0.5) * 3, y: random.next() * 2, z: (random.next() - 0.5) * 3 },
      true,
    )
    entry.body.setAngvel(
      {
        x: (random.next() - 0.5) * 19,
        y: (random.next() - 0.5) * 19,
        z: (random.next() - 0.5) * 19,
      },
      true,
    )
    entry.body.wakeUp()
  })

  for (let step = 0; step < Math.round(1.2 * CONFIG.defaults.simulationHz); step += 1) {
    world.step()
    containDiceInBowl(entries, NO_HELD, bowlBody)
  }

  bowlBody.setTranslation({ x: 10, y: -5, z: 0 }, true)
  const force = CONFIG.defaults.throwForce
  entries.forEach((entry, index) => {
    entry.enteredTray = false
    const fan = index - (entries.length - 1) / 2
    const velocity = entry.body.linvel()
    const targetX =
      (SCENE.bowl.spillMinimumSpeed + random.next() * SCENE.bowl.spillRandomSpeed) *
      force *
      SCENE.bowl.spillForceMultiplier *
      SCENE.bowl.spillDirectionX
    const inheritedX = velocity.x * 0.7
    entry.body.setLinvel(
      {
        x:
          SCENE.bowl.spillDirectionX < 0
            ? Math.min(inheritedX, targetX)
            : Math.max(inheritedX, targetX),
        y: Math.max(velocity.y * 0.7, SCENE.bowl.spillLiftSpeed * force),
        z:
          velocity.z * 0.65 +
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

  let stableSteps = 0
  let settledMs: number | null = null
  let maxPenetration = 0
  let maxSpeed = 0
  const maxSteps = Math.round(30 * CONFIG.defaults.simulationHz)
  for (let step = 0; step < maxSteps; step += 1) {
    world.step()
    containDiceInTray(entries)
    for (const entry of entries) {
      const velocity = entry.body.linvel()
      maxSpeed = Math.max(maxSpeed, Math.hypot(velocity.x, velocity.y, velocity.z))
    }
    maxPenetration = Math.max(maxPenetration, dicePenetration(world, entries))
    stableSteps = entries.every((entry) => isBodySettled(entry.body)) ? stableSteps + 1 : 0
    if (stableSteps >= SCENE.settlement.stableFrames) {
      settledMs = Math.round((step / CONFIG.defaults.simulationHz) * 1000)
      break
    }
  }

  const restY = entries.map((entry) => entry.body.translation().y)
  const escaped = entries.some((entry) => {
    const position = entry.body.translation()
    return Math.abs(position.x) > SCENE.tray.entryApronMaxX || position.y < -1
  })
  world.free()
  return { settledMs, maxPenetration, maxSpeed, restY, escaped }
}

beforeAll(async () => {
  await RAPIER.init()
})

it('쏟은 주사위가 트레이 안에서 빠르게 바닥에 안착한다', () => {
  const runs = SEEDS.map((seed) => simulateRoll(seed))

  for (const run of runs) {
    expect(run.escaped).toBe(false)
    expect(run.settledMs).not.toBeNull()
    // 바닥에 눕는다 — 다른 주사위 위에 올라탄 채로 끝나지 않는다.
    for (const y of run.restY) expect(y).toBeLessThan(DIE_WIDTH)
  }

  const settled = runs.map((run) => run.settledMs as number)
  const average = settled.reduce((sum, value) => sum + value, 0) / settled.length
  // 수정 전(중력 30)에는 평균 1283ms · 최악 2900ms였다 — "천천히 떨어진다"의 실체.
  expect(average).toBeLessThan(700)
  expect(Math.max(...settled)).toBeLessThan(1600)
})

it('굴러가는 주사위가 서로를 눈에 보이게 파고들지 않는다', () => {
  const runs = SEEDS.map((seed) => simulateRoll(seed))
  const worstPenetration = Math.max(...runs.map((run) => run.maxPenetration))
  const worstStepTravel =
    Math.max(...runs.map((run) => run.maxSpeed)) / CONFIG.defaults.simulationHz

  // 한 스텝 이동량이 몸통의 1/3을 넘으면 접촉이 이미 깊이 파고든 뒤에 발견된다 —
  // gravity를 올리면서 simulationHz를 안 올리면 여기서 먼저 걸린다.
  expect(worstStepTravel / DIE_WIDTH).toBeLessThan(0.34)
  // 수정 전에는 몸통 폭의 57%(0.304)까지 파고들어 "겹침"으로 보였다.
  expect(worstPenetration / DIE_WIDTH).toBeLessThan(0.25)
})

it('정착하지 못한 굴림도 상한 안에서 끝난다', () => {
  // checkSettled는 minRollDurationMs 뒤부터 정착을 보고, 끝내 성립하지 않으면
  // maxRollDurationMs에서 강제로 정렬로 넘어간다(없으면 굴림이 영원히 끝나지 않는다).
  // 상한은 실측 최악값(체공 + 정착)보다 커야 정상 굴림을 잘라먹지 않는다.
  const worstRoll = SCENE.bowl.tiltDurationMs + SCENE.bowl.spillPushDurationMs + 1600
  expect(SCENE.settlement.maxRollDurationMs).toBeGreaterThan(SCENE.settlement.minRollDurationMs)
  expect(SCENE.settlement.maxRollDurationMs).toBeGreaterThanOrEqual(worstRoll)
})
