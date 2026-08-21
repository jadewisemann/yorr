import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { PHYSICS_DICE_CONFIG } from './config'
import type { PhysicsDiceGeometries } from './model'

const SCENE = PHYSICS_DICE_CONFIG.scene
const UP = new THREE.Vector3(0, 1, 0)

export function createTray(scene: THREE.Scene, world: RAPIER.World) {
  const tray = SCENE.tray
  const centerZ = (tray.rollingMinZ + tray.rollingMaxZ) / 2
  const halfDepth = (tray.rollingMaxZ - tray.rollingMinZ) / 2
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(tray.halfSize, 0.1, tray.halfSize)
      .setTranslation(0, -0.1, 0)
      .setFriction(0.82)
      .setRestitution(0.24),
  )
  for (const [x, z, halfX, halfZ] of [
    [-tray.rollingHalfWidth - 0.12, centerZ, 0.12, halfDepth],
    [0, tray.rollingMinZ - 0.12, tray.rollingHalfWidth, 0.12],
    [0, tray.rollingMaxZ + 0.12, tray.rollingHalfWidth, 0.12],
  ] as const) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfX, 1.1, halfZ)
        .setTranslation(x, 1, z)
        .setFriction(0.65)
        .setRestitution(0.42),
    )
  }
  const apronHalf = (tray.entryApronMaxX - tray.halfSize) / 2
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(apronHalf, 0.1, halfDepth)
      .setTranslation(tray.halfSize + apronHalf, -0.1, centerZ)
      .setFriction(0.76)
      .setRestitution(0.2),
  )

  const RAIL_SPAN = 40
  const floorMaterial = new THREE.ShadowMaterial({ opacity: 0.3 })
  const railMaterial = new THREE.MeshBasicMaterial()
  const railLineMaterial = new THREE.MeshBasicMaterial()
  const railShadowMaterial = new THREE.ShadowMaterial({ opacity: 0.3 })
  const trayMaterials: THREE.Material[] = [
    floorMaterial,
    railMaterial,
    railLineMaterial,
    railShadowMaterial,
  ]
  /*
   * 그림자 받는 바닥판. **트레이 크기(halfSize 2.9)가 아니라 레일과 같은 RAIL_SPAN이다.**
   *
   * 직교 카메라가 보여 주는 폭은 컨테이너 비율을 따라간다(World.resize:
   * vertical = clamp(4.25/aspect, 3.35, 4.6), horizontal = vertical × aspect) — 실측하면
   * 320px에서 ±3.47, 1440px에서 ±4.94다. 즉 **모든 브레이크포인트에서 화면이 2.9보다
   * 넓고**, 5.8×5.8짜리 판을 쓰면 x=2.9를 넘어간 그림자가 수직으로 잘린다(다섯 번째
   * 주사위와 쏟는 사발이 실제로 그 자리에 온다). 다크에서는 검정 30% 그림자가 매트에
   * 묻혀 안 보였고 라이트 테마가 그것을 드러냈다.
   *
   * 키워도 비용이 없다: `ShadowMaterial`은 그림자가 닿는 자리 말고는 그리지 않고,
   * 그림자 해상도를 정하는 것은 이 판이 아니라 광원의 shadow camera(±6·±5 × mapSize)다.
   */
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(RAIL_SPAN, RAIL_SPAN), floorMaterial)
  floor.rotation.x = -Math.PI / 2
  floor.position.y = 0.002
  floor.receiveShadow = true
  const rail = new THREE.Mesh(new THREE.PlaneGeometry(RAIL_SPAN, RAIL_SPAN), railMaterial)
  rail.rotation.x = -Math.PI / 2
  rail.position.set(0, 0.004, tray.separatorZ + RAIL_SPAN / 2)
  const railLine = new THREE.Mesh(new THREE.PlaneGeometry(RAIL_SPAN, 0.05), railLineMaterial)
  railLine.rotation.x = -Math.PI / 2
  railLine.position.set(0, 0.005, tray.separatorZ + 0.025)
  /*
   * 킵 레일 위의 그림자판. 레일은 불투명이라 아래 바닥판을 가리고, 자기는
   * `MeshBasicMaterial`(조명을 안 받는다)이라 그림자를 못 받는다 — 그래서 킵한
   * 주사위만 그림자가 하나도 없었다(라이트에서 스티커처럼 떠 보인다).
   *
   * 레일을 조명 받는 재질로 바꾸는 대신 판을 하나 더 얹는 이유: 레일 색은
   * 토큰이 정하는 **평면색**이고(`appearance.ts`가 원시값을 그대로 넣는다),
   * 조명·톤매핑을 태우면 그 값과 화면색이 또 한 겹 어긋난다.
   *
   * y는 레일(0.004)과 킵 슬롯 막대(0.018) 사이 — 막대는 그림자 위에 또렷하게 남는다.
   */
  const railShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(RAIL_SPAN, RAIL_SPAN),
    railShadowMaterial,
  )
  railShadow.rotation.x = -Math.PI / 2
  railShadow.position.set(0, 0.008, tray.separatorZ + RAIL_SPAN / 2)
  railShadow.receiveShadow = true
  scene.add(floor, rail, railLine, railShadow)

  return { floorMaterial, railMaterial, railLineMaterial, trayMaterials }
}

export function createBowl(scene: THREE.Scene, world: RAPIER.World) {
  const visual = SCENE.bowl.visual
  const bowlGroup = new THREE.Group()
  bowlGroup.visible = false
  const shellMaterial = new THREE.MeshStandardMaterial({
    color: 0x141517,
    roughness: 0.72,
    metalness: 0.08,
    side: THREE.DoubleSide,
  })
  const bowlInnerMaterial = new THREE.MeshStandardMaterial({
    roughness: 0.92,
    metalness: 0.01,
    side: THREE.DoubleSide,
  })
  const rimMaterial = new THREE.MeshStandardMaterial({
    color: 0x24252a,
    roughness: 0.55,
    metalness: 0.12,
  })
  const bowlMaterials: THREE.Material[] = [shellMaterial, bowlInnerMaterial, rimMaterial]
  const shellProfile = [
    new THREE.Vector2(0, visual.outerBottomY),
    new THREE.Vector2(visual.outerBottomRadius, visual.outerBottomY),
    new THREE.Vector2(visual.outerRimRadius, visual.rimY - 0.08),
    new THREE.Vector2(visual.outerRimRadius, visual.rimY),
    new THREE.Vector2(visual.innerRimRadius, visual.rimY),
    new THREE.Vector2(visual.innerBottomRadius, visual.innerBottomY),
    new THREE.Vector2(0, visual.innerBottomY),
  ]
  const shell = new THREE.Mesh(
    new THREE.LatheGeometry(shellProfile, visual.segments),
    shellMaterial,
  )
  shell.castShadow = true
  shell.receiveShadow = true
  const bowlInner = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0, visual.innerBottomY + 0.006),
        new THREE.Vector2(visual.innerBottomRadius, visual.innerBottomY + 0.006),
        new THREE.Vector2(visual.innerRimRadius - 0.015, visual.rimY - 0.035),
      ],
      visual.segments,
    ),
    bowlInnerMaterial,
  )
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(visual.rimRadius, visual.rimTube, 12, visual.segments),
    rimMaterial,
  )
  rim.rotation.x = Math.PI / 2
  rim.position.y = visual.rimY
  bowlGroup.add(shell, bowlInner, rim)
  scene.add(bowlGroup)

  const bowlBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased())
  world.createCollider(
    RAPIER.ColliderDesc.cylinder(
      SCENE.bowl.colliderBottomHalfHeight,
      SCENE.bowl.colliderBottomRadius,
    )
      .setTranslation(0, SCENE.bowl.colliderBottomY, 0)
      .setFriction(0.82)
      .setRestitution(0.28),
    bowlBody,
  )
  for (let index = 0; index < 14; index += 1) {
    const angle = (index / 14) * Math.PI * 2
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        SCENE.bowl.colliderWallHalfWidth,
        SCENE.bowl.colliderWallHalfHeight,
        SCENE.bowl.colliderWallHalfDepth,
      )
        .setTranslation(
          Math.cos(angle) * SCENE.bowl.colliderWallRadius,
          SCENE.bowl.colliderWallY,
          Math.sin(angle) * SCENE.bowl.colliderWallRadius,
        )
        .setRotation(new THREE.Quaternion().setFromAxisAngle(UP, angle + Math.PI / 2))
        .setFriction(0.68)
        .setRestitution(0.42),
      bowlBody,
    )
  }
  world.createCollider(
    RAPIER.ColliderDesc.cylinder(SCENE.bowl.colliderLidHalfHeight, SCENE.bowl.colliderLidRadius)
      .setTranslation(0, SCENE.bowl.colliderLidY, 0)
      .setFriction(0.4)
      .setRestitution(0.45),
    bowlBody,
  )
  bowlBody.setTranslation({ x: 10, y: -5, z: 0 }, false)

  return { bowlBody, bowlGroup, bowlInner, bowlInnerMaterial, bowlMaterials }
}

export function createKeepSlots(scene: THREE.Scene, geometries: PhysicsDiceGeometries) {
  const slot = SCENE.keepSlots
  const occupied = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  const empty = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  const keepSlotMaterials: THREE.Material[] = [occupied, empty]
  const barOffset =
    PHYSICS_DICE_CONFIG.scene.baseDiceSize *
      (0.5 + slot.borderOffsetRatio + slot.borderWidthRatio) +
    slot.barGap
  const keepSlots = Array.from({ length: 5 }, () => {
    const group = new THREE.Group()
    const bar = new THREE.Mesh(geometries.slotBar, empty)
    bar.position.y = -barOffset
    group.add(bar)
    group.rotation.x = -Math.PI / 2
    scene.add(group)
    return group
  })

  return { keepSlotMaterials, keepSlots }
}
