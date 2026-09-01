import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { PHYSICS_DICE_CONFIG } from './config'
import { createDieModel, createPhysicsDiceGeometries, createPhysicsDiceMaterials } from './model'
import type { DieEntry } from './runtimeTypes'
import type { PhysicsDiceIndex } from './types'

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
        .setSoftCcdPrediction(PHYSICS_DICE_CONFIG.defaults.softCcdPrediction),
    )
    const halfSize =
      PHYSICS_DICE_CONFIG.defaults.diceSize * PHYSICS_DICE_CONFIG.scene.colliderHalfRatio
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfSize, halfSize, halfSize)
        .setMass(PHYSICS_DICE_CONFIG.defaults.mass)
        .setFriction(PHYSICS_DICE_CONFIG.defaults.friction)
        .setRestitution(PHYSICS_DICE_CONFIG.defaults.restitution)
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
