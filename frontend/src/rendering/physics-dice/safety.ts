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
  entries.forEach((entry) => {
    if (held[entry.index]) return
    const position = entry.body.translation()
    const dx = position.x - center.x
    const dz = position.z - center.z
    const radius = Math.hypot(dx, dz)
    if (radius <= maxRadius || radius === 0) return
    const normalX = dx / radius
    const normalZ = dz / radius
    const velocity = entry.body.linvel()
    const outwardSpeed = velocity.x * normalX + velocity.z * normalZ
    entry.body.setTranslation(
      {
        x: center.x + normalX * maxRadius,
        y: position.y,
        z: center.z + normalZ * maxRadius,
      },
      true,
    )
    if (outwardSpeed > 0) {
      entry.body.setLinvel(
        {
          x: velocity.x - normalX * outwardSpeed * 1.35,
          y: velocity.y,
          z: velocity.z - normalZ * outwardSpeed * 1.35,
        },
        true,
      )
    }
  })
}

/** DieEntry의 부분 shape — 예측용 복제 월드의 바디에도 같은 보정을 적용하기 위한 최소 단위. */
export interface TrayOccupant {
  body: RAPIER.RigidBody
  enteredTray: boolean
}

export function containDiceInTray(entries: TrayOccupant[]) {
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
