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

  // 디자인 Yacht Play 3D — 벽·질감 없는 평면 무대. 바닥은 그림자만 받고,
  // 킵 레일은 분리선(악센트) 아래로 화면 끝까지 깔리는 플랫 밴드다.
  // RAIL_SPAN은 카메라 최대 프러스텀보다 크게 잡아 어떤 종횡비에서도 가장자리가 안 보이게 한다.
  const RAIL_SPAN = 40
  const floorMaterial = new THREE.ShadowMaterial({ opacity: 0.3 })
  const railMaterial = new THREE.MeshBasicMaterial()
  const railLineMaterial = new THREE.MeshBasicMaterial()
  const trayMaterials: THREE.Material[] = [floorMaterial, railMaterial, railLineMaterial]
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(tray.halfSize * 2, tray.halfSize * 2),
    floorMaterial,
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = 0.002
  floor.receiveShadow = true
  const rail = new THREE.Mesh(new THREE.PlaneGeometry(RAIL_SPAN, RAIL_SPAN), railMaterial)
  rail.rotation.x = -Math.PI / 2
  rail.position.set(0, 0.004, tray.separatorZ + RAIL_SPAN / 2)
  const railLine = new THREE.Mesh(new THREE.PlaneGeometry(RAIL_SPAN, 0.05), railLineMaterial)
  railLine.rotation.x = -Math.PI / 2
  railLine.position.set(0, 0.005, tray.separatorZ + 0.025)
  scene.add(floor, rail, railLine)

  return { floorMaterial, railMaterial, railLineMaterial, trayMaterials }
}

export function createBowl(scene: THREE.Scene, world: RAPIER.World) {
  const visual = SCENE.bowl.visual
  const bowlGroup = new THREE.Group()
  bowlGroup.visible = false
  const shellMaterial = new THREE.MeshStandardMaterial({
    color: 0x161a17,
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
    color: 0x2a302b,
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
  bowlBody.setTranslation({ x: 10, y: -5, z: 0 }, false)

  return { bowlBody, bowlGroup, bowlInner, bowlInnerMaterial, bowlMaterials }
}

/**
 * 킵 슬롯 — 카드 프레임·그림자 대신 주사위 발치에 깔리는 평면 막대 하나.
 * 점유된 슬롯은 악센트, 빈 슬롯은 muted 색으로 positionKeepSlots가 바꿔 끼운다.
 */
export function createKeepSlots(scene: THREE.Scene, geometries: PhysicsDiceGeometries) {
  const slot = SCENE.keepSlots
  const occupied = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  const empty = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  const keepSlotMaterials: THREE.Material[] = [occupied, empty]
  // 그룹이 rotateX(-90°)로 눕기 때문에 로컬 -y가 화면 아래(+z)다.
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
