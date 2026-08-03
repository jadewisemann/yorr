import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { PHYSICS_DICE_CONFIG } from './config'
import { createDieModel, createPhysicsDiceGeometries, createPhysicsDiceMaterials } from './model'
import type { DieEntry } from './runtimeTypes'
import type { PhysicsDiceIndex } from './types'

export type DiceInstances = ReturnType<typeof createDiceInstances>

export function createDiceInstances(scene: THREE.Scene, world: RAPIER.World) {
  const geometries = createPhysicsDiceGeometries()
  const materials = createPhysicsDiceMaterials()
  const entries: DieEntry[] = []

  for (let index = 0; index < 5; index += 1) {
    const dieIndex = index as PhysicsDiceIndex
    const mesh = createDieModel(index, materials, geometries)
    const outlineMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const outline = new THREE.Mesh(geometries.outline, outlineMaterial)
    outline.rotation.x = -Math.PI / 2
    outline.renderOrder = 3
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation((index - 2) * 1.2, 0.52, 0)
        .setLinearDamping(PHYSICS_DICE_CONFIG.defaults.linearDamping)
        .setAngularDamping(PHYSICS_DICE_CONFIG.defaults.angularDamping)
        .setCanSleep(true)
        .setCcdEnabled(true)
        /* soft CCD — 빠르게 움직이는 작은 물체가 서로를 뚫는 것을 예측으로 막는다.
           스텝 주기만 올려서는 주사위끼리 관통이 0.136에서 더 안 내려가는데 이걸 켜면 0.073. */
        .setSoftCcdPrediction(PHYSICS_DICE_CONFIG.defaults.softCcdPrediction),
    )
    const halfSize =
      PHYSICS_DICE_CONFIG.defaults.diceSize * PHYSICS_DICE_CONFIG.scene.colliderHalfRatio
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfSize, halfSize, halfSize)
        .setMass(PHYSICS_DICE_CONFIG.defaults.mass)
        .setFriction(PHYSICS_DICE_CONFIG.defaults.friction)
        .setRestitution(PHYSICS_DICE_CONFIG.defaults.restitution)
        /* Max 결합 — 트레이 바닥(0.24)과의 반발이 평균으로 깎이지 않고 주사위 값이 그대로
           쓰인다. 던져진 뒤 눈에 보이는 튕김이 여기서 나온다(S15P11A406-129). */
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max),
      body,
    )
    scene.add(mesh, outline)
    entries.push({
      mesh,
      body,
      collider,
      outline,
      index: dieIndex,
      enteredTray: false,
      visualOffset: new THREE.Quaternion(),
    })
  }

  return { entries, geometries, materials }
}
