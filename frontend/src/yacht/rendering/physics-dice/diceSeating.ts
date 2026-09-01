import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { PHYSICS_DICE_CONFIG } from './config'
import { keepSlotPosition, keepSlotScale, simulationDieScale } from './layout'
import { quaternionForTopValue } from './model'
import type { PhysicsDiceRandom } from './random'
import type { DieEntry } from './runtimeTypes'
import type { PhysicsDiceIndex, PhysicsDiceSet, PhysicsHeldDice } from './types'

const CONFIG = PHYSICS_DICE_CONFIG
const SCENE = CONFIG.scene

/**
 * 굴림을 시작할 때의 주사위 배치.
 *
 * 잡아 둔 주사위는 킵 자리에 **고정**으로 세워 확정된 눈을 보이게 하고, 나머지는
 * 그릇 안에 무작위 자세·속도로 떨어뜨린다. 같은 seed면 같은 자세가 나오도록 난수는
 * 인자로 받는다 — 그래야 굴림이 재현된다.
 */
export function seatDiceForShake(params: {
  readonly entries: readonly DieEntry[]
  readonly held: PhysicsHeldDice
  readonly heldOrder: readonly PhysicsDiceIndex[]
  readonly committedDice: PhysicsDiceSet
  readonly random: PhysicsDiceRandom
}): void {
  const { entries, heldOrder, committedDice, random } = params
  const request = { held: params.held }
  const heldSlots = new Map(heldOrder.map((index, slot) => [index, slot]))
  entries.forEach((entry) => {
    const isHeld = request.held[entry.index]
    const halfSize = CONFIG.defaults.diceSize * SCENE.colliderHalfRatio * SCENE.bowlDiceScale
    entry.collider.setShape(new RAPIER.Cuboid(halfSize, halfSize, halfSize))
    if (isHeld) {
      const position = keepSlotPosition(heldSlots.get(entry.index) ?? 0)
      entry.mesh.visible = true
      entry.mesh.scale.setScalar(keepSlotScale())
      entry.body.setBodyType(RAPIER.RigidBodyType.Fixed, true)
      entry.body.setTranslation(position, true)
      entry.body.setRotation(quaternionForTopValue(committedDice[entry.index]), true)
      entry.outline.position.set(position.x, 0.04, position.z)
      entry.outline.scale.set(keepSlotScale(), keepSlotScale(), 1)
      entry.outline.visible = true
      entry.outline.material.opacity = 0.92
      return
    }

    const angle = (entry.index / entries.length) * Math.PI * 2 - Math.PI / 2
    const radius = SCENE.bowl.spawnRadius + (random.next() - 0.5) * SCENE.bowl.spawnJitter
    entry.outline.visible = false
    entry.mesh.visible = true
    entry.mesh.scale.setScalar(simulationDieScale())
    entry.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
    entry.body.setLinearDamping(CONFIG.defaults.linearDamping)
    entry.body.setAngularDamping(CONFIG.defaults.angularDamping)
    entry.body.setTranslation(
      {
        x: SCENE.bowl.startX + Math.cos(angle) * radius,
        y: SCENE.bowl.hoverY + SCENE.bowl.spawnBaseY + random.next() * SCENE.bowl.spawnRangeY,
        z: SCENE.bowl.startZ + Math.sin(angle) * radius,
      },
      true,
    )
    entry.body.setRotation(randomQuaternion(random), true)
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
}

/** 무작위 자세. 굴림 seed에서 나오므로 같은 굴림은 같은 자세로 시작한다. */
function randomQuaternion(random: PhysicsDiceRandom): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      random.next() * Math.PI * 2,
      random.next() * Math.PI * 2,
      random.next() * Math.PI * 2,
    ),
  )
}

/**
 * 화면 크기와 카메라 반폭에서 정사영 절두체를 구한다. 가로가 너무 좁아지면 세로를
 * 늘려 최소 폭을 지킨다 — 좁은 화면에서 주사위가 잘려 보이지 않게.
 */
export function orthographicFrustum(params: {
  readonly width: number
  readonly height: number
  readonly cameraHorizontal: number
}): { readonly horizontal: number; readonly vertical: number } {
  const aspect = params.width / params.height
  let vertical = Math.max(
    SCENE.camera.minHalfHeight,
    Math.min(params.cameraHorizontal / aspect, SCENE.camera.maxHalfHeight),
  )
  let horizontal = vertical * aspect
  if (horizontal < SCENE.camera.minHalfWidth) {
    horizontal = SCENE.camera.minHalfWidth
    vertical = horizontal / aspect
  }
  return { horizontal, vertical }
}
