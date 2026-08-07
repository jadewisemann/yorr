import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { createBowl, createKeepSlots, createTray } from '@/yacht/rendering/physics-dice/arena'
import { PHYSICS_DICE_CONFIG } from '@/yacht/rendering/physics-dice/config'
import { createPhysicsDiceGeometries } from '@/yacht/rendering/physics-dice/model'

const SCENE = PHYSICS_DICE_CONFIG.scene
const DIE_HALF = PHYSICS_DICE_CONFIG.defaults.diceSize * SCENE.colliderHalfRatio

function world() {
  const created = new RAPIER.World({ x: 0, y: -PHYSICS_DICE_CONFIG.defaults.gravity, z: 0 })
  created.timestep = 1 / PHYSICS_DICE_CONFIG.defaults.simulationHz
  return created
}

/** 판 위에 굴러다니는 주사위 하나. */
function die(physics: RAPIER.World, position: { x: number; y: number; z: number }) {
  const body = physics.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setCcdEnabled(true),
  )
  physics.createCollider(
    RAPIER.ColliderDesc.cuboid(DIE_HALF, DIE_HALF, DIE_HALF)
      .setMass(PHYSICS_DICE_CONFIG.defaults.mass)
      .setFriction(PHYSICS_DICE_CONFIG.defaults.friction)
      .setRestitution(PHYSICS_DICE_CONFIG.defaults.restitution),
    body,
  )
  return body
}

function simulate(physics: RAPIER.World, steps: number) {
  for (let step = 0; step < steps; step += 1) physics.step()
}

beforeAll(async () => {
  await RAPIER.init()
})

describe('createTray', () => {
  it('바닥이 주사위를 받쳐 세운다 — 판 아래로 빠지지 않는다', () => {
    const physics = world()
    createTray(new THREE.Scene(), physics)
    const body = die(physics, { x: 0, y: 2.5, z: 0 })

    simulate(physics, 300)

    expect(body.translation().y).toBeGreaterThan(0)
    expect(body.translation().y).toBeLessThan(DIE_HALF * 2 + 0.1)
    physics.free()
  })

  it('왼쪽·앞·뒤 벽이 굴러가는 주사위를 롤링 존 안에 붙잡는다', () => {
    const physics = world()
    createTray(new THREE.Scene(), physics)
    const cases = [
      { linvel: { x: -14, y: 0, z: 0 }, name: 'left' },
      { linvel: { x: 0, y: 0, z: -14 }, name: 'far' },
      { linvel: { x: 0, y: 0, z: 14 }, name: 'near' },
    ]
    const bodies = cases.map((entry) => {
      const body = die(physics, { x: 0, y: 0.6, z: -0.6 })
      body.setLinvel(entry.linvel, true)
      return body
    })

    simulate(physics, 300)

    bodies.forEach((body) => {
      const position = body.translation()
      expect(position.x).toBeGreaterThan(-SCENE.tray.rollingHalfWidth - 0.5)
      expect(position.z).toBeGreaterThan(SCENE.tray.rollingMinZ - 0.5)
      expect(position.z).toBeLessThan(SCENE.tray.rollingMaxZ + 0.5)
    })
    physics.free()
  })

  it('오른쪽은 열려 있고 진입 에이프런이 바닥을 이어 준다 — 사발에서 쏟는 통로다', () => {
    const physics = world()
    createTray(new THREE.Scene(), physics)
    // 판 오른쪽 밖(에이프런 위)에 떨어뜨려도 바닥이 받쳐야 한다.
    const body = die(physics, { x: SCENE.tray.halfSize + 0.8, y: 2, z: -0.6 })

    simulate(physics, 300)

    expect(body.translation().y).toBeGreaterThan(0)
    expect(SCENE.tray.entryApronMaxX).toBeGreaterThan(SCENE.tray.halfSize)
    physics.free()
  })

  it('킵 레일은 카메라 프러스텀보다 넓게 깔리고 분리선이 레일 위에 겹쳐 그려진다', () => {
    const scene = new THREE.Scene()

    const { railLineMaterial, railMaterial, trayMaterials } = createTray(scene, world())
    const planes = scene.children.filter(
      (child): child is THREE.Mesh<THREE.PlaneGeometry> =>
        child instanceof THREE.Mesh && child.geometry instanceof THREE.PlaneGeometry,
    )
    const rail = planes.find((mesh) => mesh.material === railMaterial)
    const railLine = planes.find((mesh) => mesh.material === railLineMaterial)
    const floor = planes.find((mesh) => mesh.receiveShadow)

    if (!rail || !railLine || !floor) throw new Error('바닥·레일·분리선 메시가 없습니다.')
    expect(rail.geometry.parameters.width).toBeGreaterThan(SCENE.camera.maxHalfHeight * 4)
    // 분리선이 레일보다 위에 있어야 z-fighting 없이 보인다.
    expect(railLine.position.y).toBeGreaterThan(rail.position.y)
    expect(rail.position.y).toBeGreaterThan(floor.position.y)
    expect(railLine.position.z).toBeCloseTo(SCENE.tray.separatorZ + 0.025, 6)
    // 모든 재질을 dispose 대상 목록에 실어야 누수가 없다.
    expect(trayMaterials).toContain(railMaterial)
    expect(trayMaterials).toContain(railLineMaterial)
  })
})

describe('createBowl', () => {
  it('사발은 숨은 채 화면 밖에 주차된 상태로 시작한다', () => {
    const physics = world()

    const { bowlBody, bowlGroup } = createBowl(new THREE.Scene(), physics)

    expect(bowlGroup.visible).toBe(false)
    expect(bowlBody.translation().x).toBeGreaterThan(SCENE.camera.resultHalfWidth)
    expect(bowlBody.translation().y).toBeLessThan(0)
    physics.free()
  })

  it('위치 지정 kinematic 바디다 — 흔들림·기울임을 코드가 프레임마다 지시한다', () => {
    const physics = world()

    const { bowlBody } = createBowl(new THREE.Scene(), physics)

    expect(bowlBody.isKinematic()).toBe(true)
    expect(bowlBody.isDynamic()).toBe(false)
    physics.free()
  })

  it('사발 바닥과 벽이 주사위를 담아 둔다 — 흔들기 전부터 새지 않는다', () => {
    const physics = world()
    const { bowlBody } = createBowl(new THREE.Scene(), physics)
    bowlBody.setTranslation({ x: 0, y: SCENE.bowl.hoverY, z: 0 }, false)
    const body = die(physics, { x: SCENE.bowl.spawnRadius, y: SCENE.bowl.hoverY + 1.2, z: 0 })
    body.setLinvel({ x: 6, y: 0, z: 3 }, true)

    simulate(physics, 400)

    const position = body.translation()
    const radius = Math.hypot(position.x, position.z)
    expect(radius).toBeLessThan(SCENE.bowl.colliderWallRadius)
    expect(position.y).toBeGreaterThan(SCENE.bowl.hoverY)
    physics.free()
  })

  it('사발을 기울이면 담긴 주사위가 쏟아져 나온다', () => {
    const physics = world()
    const { bowlBody } = createBowl(new THREE.Scene(), physics)
    bowlBody.setTranslation({ x: 0, y: SCENE.bowl.hoverY, z: 0 }, false)
    const body = die(physics, { x: 0, y: SCENE.bowl.hoverY + 0.8, z: 0 })
    simulate(physics, 120)
    const contained = body.translation().y

    bowlBody.setNextKinematicRotation(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        THREE.MathUtils.degToRad(SCENE.bowl.tiltDegrees),
      ),
    )
    simulate(physics, 400)

    expect(contained).toBeGreaterThan(SCENE.bowl.hoverY)
    // 사발이 뒤집히면 주사위는 더 이상 사발 안 높이에 머물지 못한다.
    expect(body.translation().y).toBeLessThan(contained)
    physics.free()
  })

  it('사발 메시는 그룹 하나로 묶여 위치·회전을 한 번에 받는다', () => {
    const scene = new THREE.Scene()

    const { bowlGroup, bowlInner } = createBowl(scene, world())

    expect(scene.children).toContain(bowlGroup)
    expect(bowlGroup.children).toContain(bowlInner)
    expect(bowlGroup.children.length).toBeGreaterThanOrEqual(3)
    // 사발 껍데기는 그림자를 던지고 받아 무대 위에 놓인 것처럼 보인다.
    const shell = bowlGroup.children[0]
    expect(shell?.castShadow).toBe(true)
  })
})

describe('createKeepSlots', () => {
  it('슬롯 5개를 바닥에 눕혀 장면에 올리고 바를 주사위 발치(+z)에 둔다', () => {
    const scene = new THREE.Scene()
    const geometries = createPhysicsDiceGeometries()

    const { keepSlotMaterials, keepSlots } = createKeepSlots(scene, geometries)

    expect(keepSlots).toHaveLength(5)
    expect(keepSlotMaterials).toHaveLength(2)
    keepSlots.forEach((slot) => {
      expect(scene.children).toContain(slot)
      expect(slot.rotation.x).toBeCloseTo(-Math.PI / 2, 6)
      const bar = slot.children[0]
      if (!(bar instanceof THREE.Mesh)) throw new Error('슬롯 바가 없습니다.')
      expect(bar.geometry).toBe(geometries.slotBar)
      // 그룹이 눕기 때문에 로컬 -y가 화면 아래쪽이다 — 바는 주사위 아래에 깔린다.
      expect(bar.position.y).toBeLessThan(0)
    })
  })

  it('슬롯 5개가 슬롯 바 지오메트리를 공유한다', () => {
    const geometries = createPhysicsDiceGeometries()

    const { keepSlots } = createKeepSlots(new THREE.Scene(), geometries)

    const barGeometries = new Set(
      keepSlots.map((slot) => (slot.children[0] as THREE.Mesh).geometry),
    )
    expect(barGeometries.size).toBe(1)
  })
})
