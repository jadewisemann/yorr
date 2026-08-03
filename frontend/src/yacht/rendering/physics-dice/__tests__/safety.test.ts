import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { PHYSICS_DICE_CONFIG } from '@/yacht/rendering/physics-dice/config'
import { createDiceInstances } from '@/yacht/rendering/physics-dice/diceInstances'
import type { DieEntry } from '@/yacht/rendering/physics-dice/runtimeTypes'
import {
  containDiceInBowl,
  containDiceInTray,
  type TrayOccupant,
} from '@/yacht/rendering/physics-dice/safety'
import type { PhysicsHeldDice } from '@/yacht/rendering/physics-dice/types'

const SCENE = PHYSICS_DICE_CONFIG.scene
const NONE_HELD: PhysicsHeldDice = [false, false, false, false, false]
const DIE_RADIUS =
  PHYSICS_DICE_CONFIG.defaults.diceSize * SCENE.colliderHalfRatio * SCENE.bowlDiceScale
const MAX_BOWL_RADIUS = SCENE.bowl.containmentRadius - DIE_RADIUS
const TRAY_MARGIN =
  (PHYSICS_DICE_CONFIG.defaults.diceSize * SCENE.bowlDiceScale) / 2 + SCENE.safety.margin
const MAX_X = SCENE.tray.rollingHalfWidth - TRAY_MARGIN
const MAX_Z = SCENE.tray.rollingMaxZ - TRAY_MARGIN
const MIN_Z = SCENE.tray.rollingMinZ + TRAY_MARGIN

describe('containDiceInBowl', () => {
  beforeAll(async () => {
    await RAPIER.init()
  })

  function setup() {
    const world = new RAPIER.World({ x: 0, y: -18, z: 0 })
    const { entries } = createDiceInstances(new THREE.Scene(), world)
    const bowlBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased())
    bowlBody.setTranslation({ x: 0.5, y: SCENE.bowl.hoverY, z: -0.6 }, false)
    return { bowlBody, entries, world }
  }

  function distanceFromBowl(entry: DieEntry, bowlBody: RAPIER.RigidBody) {
    const center = bowlBody.translation()
    const position = entry.body.translation()
    return Math.hypot(position.x - center.x, position.z - center.z)
  }

  it('사발 밖으로 새어 나간 주사위를 사발 벽 안쪽 경계로 되돌리고 높이는 유지한다', () => {
    const { bowlBody, entries, world } = setup()
    const entry = entries[0]
    if (!entry) throw new Error('주사위가 없습니다.')
    const center = bowlBody.translation()
    entry.body.setTranslation({ x: center.x + 6, y: 1.4, z: center.z + 6 }, true)

    containDiceInBowl(entries, NONE_HELD, bowlBody)

    expect(distanceFromBowl(entry, bowlBody)).toBeCloseTo(MAX_BOWL_RADIUS, 5)
    expect(entry.body.translation().y).toBeCloseTo(1.4, 5)
    world.free()
  })

  it('벽을 향해 나가던 속도는 안쪽으로 되돌려 다시 새어 나가지 않게 한다', () => {
    const { bowlBody, entries, world } = setup()
    const entry = entries[1]
    if (!entry) throw new Error('주사위가 없습니다.')
    const center = bowlBody.translation()
    entry.body.setTranslation({ x: center.x + 4, y: 1, z: center.z }, true)
    entry.body.setLinvel({ x: 5, y: 0.4, z: 0 }, true)

    containDiceInBowl(entries, NONE_HELD, bowlBody)

    const velocity = entry.body.linvel()
    expect(velocity.x).toBeLessThan(0)
    // 수직 성분은 그대로 — 사발 안에서 튀어 오르는 움직임은 살려 둔다.
    expect(velocity.y).toBeCloseTo(0.4, 5)
    world.free()
  })

  it('이미 안쪽으로 들어오는 중이면 속도를 건드리지 않는다', () => {
    const { bowlBody, entries, world } = setup()
    const entry = entries[2]
    if (!entry) throw new Error('주사위가 없습니다.')
    const center = bowlBody.translation()
    entry.body.setTranslation({ x: center.x + 4, y: 1, z: center.z }, true)
    entry.body.setLinvel({ x: -3, y: 0, z: 1 }, true)

    containDiceInBowl(entries, NONE_HELD, bowlBody)

    expect(entry.body.linvel().x).toBeCloseTo(-3, 5)
    expect(entry.body.linvel().z).toBeCloseTo(1, 5)
    world.free()
  })

  it('킵된 주사위와 사발 중심에 정확히 있는 주사위는 손대지 않는다', () => {
    const { bowlBody, entries, world } = setup()
    const held: PhysicsHeldDice = [true, false, false, false, false]
    const center = bowlBody.translation()
    const heldEntry = entries[0]
    const centeredEntry = entries[1]
    if (!heldEntry || !centeredEntry) throw new Error('주사위가 없습니다.')
    heldEntry.body.setTranslation({ x: 9, y: 0.5, z: 9 }, true)
    centeredEntry.body.setTranslation({ x: center.x, y: 1, z: center.z }, true)

    containDiceInBowl(entries, held, bowlBody)

    expect(heldEntry.body.translation().x).toBeCloseTo(9, 5)
    expect(heldEntry.body.translation().z).toBeCloseTo(9, 5)
    expect(centeredEntry.body.translation().x).toBeCloseTo(center.x, 5)
    world.free()
  })

  it('사발이 움직이면 경계도 함께 움직인다 — 같은 위치가 사발 위치에 따라 안/밖이 갈린다', () => {
    const { bowlBody, entries, world } = setup()
    const entry = entries[3]
    if (!entry) throw new Error('주사위가 없습니다.')
    bowlBody.setTranslation({ x: 3, y: SCENE.bowl.hoverY, z: 0 }, false)
    entry.body.setTranslation({ x: 3.2, y: 1, z: 0 }, true)

    containDiceInBowl(entries, NONE_HELD, bowlBody)

    expect(entry.body.translation().x).toBeCloseTo(3.2, 5)

    bowlBody.setTranslation({ x: 0, y: SCENE.bowl.hoverY, z: 0 }, false)
    containDiceInBowl(entries, NONE_HELD, bowlBody)

    expect(entry.body.translation().x).toBeCloseTo(MAX_BOWL_RADIUS, 5)
    world.free()
  })
})

describe('containDiceInTray', () => {
  beforeAll(async () => {
    await RAPIER.init()
  })

  function occupant(position: { x: number; y: number; z: number }, enteredTray: boolean) {
    const world = new RAPIER.World({ x: 0, y: -18, z: 0 })
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0, 0))
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.27, 0.27, 0.27), body)
    body.setTranslation(position, true)
    const entry: TrayOccupant = { body, enteredTray }
    return { entry, world }
  }

  it('사발에서 쏟아져 들어오는 동안(판 밖 오른쪽)은 튕기지 않는다', () => {
    const { entry, world } = occupant({ x: MAX_X + 2, y: 0.5, z: 0 }, false)
    entry.body.setLinvel({ x: -4, y: 0, z: 0 }, true)

    containDiceInTray([entry])

    expect(entry.enteredTray).toBe(false)
    expect(entry.body.translation().x).toBeCloseTo(MAX_X + 2, 5)
    expect(entry.body.linvel().x).toBeCloseTo(-4, 5)
    world.free()
  })

  it('판에 한 번 들어오면 이후에는 오른쪽 벽에서도 튕겨 나가지 못한다', () => {
    const { entry, world } = occupant({ x: MAX_X - 0.2, y: 0.5, z: 0 }, false)

    containDiceInTray([entry])
    expect(entry.enteredTray).toBe(true)

    entry.body.setTranslation({ x: MAX_X + 1, y: 0.5, z: 0 }, true)
    entry.body.setLinvel({ x: 5, y: 0, z: 0 }, true)
    containDiceInTray([entry])

    expect(entry.body.translation().x).toBeCloseTo(MAX_X, 5)
    expect(entry.body.linvel().x).toBeCloseTo(-5 * SCENE.safety.bounce, 5)
    world.free()
  })

  it('왼쪽 벽은 들어온 적이 없어도 막는다 — 나가면 화면 밖으로 사라지는 방향이다', () => {
    const { entry, world } = occupant({ x: -MAX_X - 1, y: 0.5, z: 0 }, false)
    entry.body.setLinvel({ x: -6, y: 0, z: 0 }, true)

    containDiceInTray([entry])

    expect(entry.body.translation().x).toBeCloseTo(-MAX_X, 5)
    expect(entry.body.linvel().x).toBeCloseTo(6 * SCENE.safety.bounce, 5)
    world.free()
  })

  it('앞뒤 벽은 양방향 모두 반사한다', () => {
    const far = occupant({ x: 0, y: 0.5, z: MIN_Z - 1 }, true)
    far.entry.body.setLinvel({ x: 0, y: 0, z: -3 }, true)
    containDiceInTray([far.entry])

    expect(far.entry.body.translation().z).toBeCloseTo(MIN_Z, 5)
    expect(far.entry.body.linvel().z).toBeCloseTo(3 * SCENE.safety.bounce, 5)
    far.world.free()

    const near = occupant({ x: 0, y: 0.5, z: MAX_Z + 1 }, true)
    near.entry.body.setLinvel({ x: 0, y: 0, z: 3 }, true)
    containDiceInTray([near.entry])

    expect(near.entry.body.translation().z).toBeCloseTo(MAX_Z, 5)
    expect(near.entry.body.linvel().z).toBeCloseTo(-3 * SCENE.safety.bounce, 5)
    near.world.free()
  })

  it('판 안에 있는 주사위는 위치·속도를 전혀 바꾸지 않는다', () => {
    const { entry, world } = occupant({ x: 0.3, y: 0.5, z: -0.4 }, true)
    entry.body.setLinvel({ x: 2, y: -1, z: 1.5 }, true)

    containDiceInTray([entry])

    expect(entry.body.translation()).toMatchObject({ x: expect.closeTo(0.3, 5) })
    expect(entry.body.linvel().x).toBeCloseTo(2, 5)
    expect(entry.body.linvel().y).toBeCloseTo(-1, 5)
    expect(entry.body.linvel().z).toBeCloseTo(1.5, 5)
    world.free()
  })
})
