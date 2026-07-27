import { topFaceFromQuaternion } from './model'
import type { DieEntry } from './runtimeTypes'
import type { PhysicsDiceSet } from './types'

export function readTopDice(entries: DieEntry[]): PhysicsDiceSet {
  return entries.map((entry) => topFaceFromQuaternion(entry.body.rotation())) as [
    PhysicsDiceSet[0],
    PhysicsDiceSet[1],
    PhysicsDiceSet[2],
    PhysicsDiceSet[3],
    PhysicsDiceSet[4],
  ]
}
