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

  const floorMaterial = new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0.14,
    roughness: 0.96,
  })
  const playFieldMaterial = new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0.1,
    roughness: 1,
  })
  const rimMaterial = new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0.5,
    roughness: 0.72,
    metalness: 0.05,
  })
  const trayMaterials: THREE.Material[] = [floorMaterial, playFieldMaterial, rimMaterial]
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(tray.halfSize * 2, tray.halfSize * 2),
    floorMaterial,
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = 0.002
  floor.receiveShadow = true
  const playField = new THREE.Mesh(
    new THREE.PlaneGeometry(tray.rollingHalfWidth * 2, halfDepth * 2),
    playFieldMaterial,
  )
  playField.rotation.x = -Math.PI / 2
  playField.position.set(0, 0.008, centerZ)
  playField.receiveShadow = true
  scene.add(floor, playField)

  const sideGeometry = new THREE.BoxGeometry(tray.rimWidth, tray.rimHeight, tray.halfSize * 2)
  const edgeGeometry = new THREE.BoxGeometry(tray.halfSize * 2, tray.rimHeight, tray.rimWidth)
  const rims = [
    new THREE.Mesh(sideGeometry, rimMaterial),
    new THREE.Mesh(sideGeometry, rimMaterial),
    new THREE.Mesh(edgeGeometry, rimMaterial),
    new THREE.Mesh(edgeGeometry, rimMaterial),
    new THREE.Mesh(
      new THREE.BoxGeometry(
        tray.rollingHalfWidth * 2 + tray.rimWidth,
        tray.rimHeight * 0.7,
        tray.rimWidth,
      ),
      rimMaterial,
    ),
  ]
  rims[0]?.position.set(-tray.halfSize, tray.rimHeight / 2, 0)
  rims[1]?.position.set(tray.halfSize, tray.rimHeight / 2, 0)
  rims[2]?.position.set(0, tray.rimHeight / 2, -tray.halfSize)
  rims[3]?.position.set(0, tray.rimHeight / 2, tray.halfSize)
  rims[4]?.position.set(0, tray.rimHeight * 0.35, tray.separatorZ)
  rims.forEach((rim) => {
    rim.castShadow = true
    rim.receiveShadow = true
    scene.add(rim)
  })

  return { floorMaterial, playFieldMaterial, trayMaterials }
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

export function createKeepSlots(scene: THREE.Scene, geometries: PhysicsDiceGeometries) {
  const fill = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: SCENE.keepSlots.fillOpacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const frame = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: SCENE.keepSlots.frameOpacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const shadow = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: SCENE.keepSlots.shadowOpacity,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const keepSlotMaterials: THREE.Material[] = [fill, frame, shadow]
  const keepSlots = Array.from({ length: 5 }, () => {
    const group = new THREE.Group()
    const shadowMesh = new THREE.Mesh(geometries.slotFill, shadow)
    shadowMesh.position.set(SCENE.keepSlots.shadowOffset, -SCENE.keepSlots.shadowOffset, -0.002)
    const fillMesh = new THREE.Mesh(geometries.slotFill, fill)
    const frameMesh = new THREE.Mesh(geometries.slotFrame, frame)
    frameMesh.position.z = 0.002
    group.add(shadowMesh, fillMesh, frameMesh)
    group.rotation.x = -Math.PI / 2
    scene.add(group)
    return group
  })

  return { keepSlotMaterials, keepSlots }
}
