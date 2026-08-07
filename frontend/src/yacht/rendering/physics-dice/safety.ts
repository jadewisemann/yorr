import type RAPIER from '@dimforge/rapier3d-compat'
import { PHYSICS_DICE_CONFIG } from './config'
import type { DieEntry } from './runtimeTypes'
import type { PhysicsHeldDice } from './types'

const CONFIG = PHYSICS_DICE_CONFIG
const SCENE = CONFIG.scene

export function containDiceInBowl(
  entries: DieEntry[],
  held: PhysicsHeldDice,
  bowlBody: RAPIER.RigidBody,
) {
  const center = bowlBody.translation()
  const dieRadius = CONFIG.defaults.diceSize * SCENE.colliderHalfRatio * SCENE.bowlDiceScale
  const maxRadius = SCENE.bowl.containmentRadius - dieRadius
  const bottomY = center.y + SCENE.bowl.colliderBottomY + SCENE.bowl.colliderBottomHalfHeight
  const lidY = center.y + SCENE.bowl.colliderLidY - SCENE.bowl.colliderLidHalfHeight
  entries.forEach((entry) => {
    if (held[entry.index]) return
    const position = entry.body.translation()
    const velocity = entry.body.linvel()
    const extentY = verticalHalfExtent(entry.body, dieRadius)
    const minY = bottomY + extentY
    const maxY = lidY - extentY
    const next = {
      x: position.x,
      y: position.y,
      z: position.z,
    }
    let contained = false
    if (position.y < minY - SCENE.safety.penetrationTolerance) {
      next.y = minY
      velocity.y = Math.max(0, velocity.y)
      contained = true
    } else if (position.y > maxY + SCENE.safety.penetrationTolerance) {
      next.y = maxY
      velocity.y = Math.min(0, velocity.y)
      contained = true
    }
    const dx = position.x - center.x
    const dz = position.z - center.z
    const radius = Math.hypot(dx, dz)
    if (radius > maxRadius) {
      const normalX = dx / radius
      const normalZ = dz / radius
      const outwardSpeed = velocity.x * normalX + velocity.z * normalZ
      next.x = center.x + normalX * maxRadius
      next.z = center.z + normalZ * maxRadius
      contained = true
      if (outwardSpeed > 0) {
        velocity.x -= normalX * outwardSpeed * 1.35
        velocity.z -= normalZ * outwardSpeed * 1.35
      }
    }
    if (!contained) return
    entry.body.setTranslation(next, true)
    entry.body.setLinvel(velocity, true)
  })
}

export interface TrayOccupant {
  body: RAPIER.RigidBody
  enteredTray: boolean
}

export function verticalHalfExtent(body: RAPIER.RigidBody, halfSize: number) {
  const rotation = body.rotation()
  return (
    halfSize *
    (Math.abs(2 * (rotation.x * rotation.y + rotation.z * rotation.w)) +
      Math.abs(1 - 2 * (rotation.x * rotation.x + rotation.z * rotation.z)) +
      Math.abs(2 * (rotation.y * rotation.z - rotation.x * rotation.w)))
  )
}

export function containDiceInTray(entries: TrayOccupant[]) {
  const halfSize = CONFIG.defaults.diceSize * SCENE.colliderHalfRatio * SCENE.bowlDiceScale
  const margin = (CONFIG.defaults.diceSize * SCENE.bowlDiceScale) / 2 + SCENE.safety.margin
  const maxX = SCENE.tray.rollingHalfWidth - margin
  const minZ = SCENE.tray.rollingMinZ + margin
  const maxZ = SCENE.tray.rollingMaxZ - margin
  entries.forEach((entry) => {
    const position = entry.body.translation()
    const velocity = entry.body.linvel()
    const next = { x: position.x, y: position.y, z: position.z }
    let bounced = false
    if (position.x <= maxX) entry.enteredTray = true
    const floorClearance = verticalHalfExtent(entry.body, halfSize)
    if (position.y < floorClearance - SCENE.safety.penetrationTolerance) {
      next.y = floorClearance
      velocity.y = Math.max(0, velocity.y)
      bounced = true
    }

    if (position.x > maxX && entry.enteredTray) {
      next.x = maxX
      velocity.x = -Math.abs(velocity.x) * SCENE.safety.bounce
      bounced = true
    } else if (position.x < -maxX) {
      next.x = -maxX
      velocity.x = Math.abs(velocity.x) * SCENE.safety.bounce
      bounced = true
    }
    if (position.z > maxZ) {
      next.z = maxZ
      velocity.z = -Math.abs(velocity.z) * SCENE.safety.bounce
      bounced = true
    } else if (position.z < minZ) {
      next.z = minZ
      velocity.z = Math.abs(velocity.z) * SCENE.safety.bounce
      bounced = true
    }
    if (!bounced) return
    entry.body.setTranslation(next, true)
    entry.body.setLinvel(velocity, true)
  })
}
