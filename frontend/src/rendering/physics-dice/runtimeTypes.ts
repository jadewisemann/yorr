import type RAPIER from '@dimforge/rapier3d-compat'
import type * as THREE from 'three'
import type { PhysicsDiceIndex } from './types'

export type DieEntry = {
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
  enteredTray: boolean
  index: PhysicsDiceIndex
  mesh: THREE.Group
  outline: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>
}

export type AlignmentEntry = {
  entry: DieEntry
  fromPosition: THREE.Vector3
  fromQuaternion: THREE.Quaternion
  fromScale: number
  held: boolean
  slotIndex: number
  targetPosition: THREE.Vector3
  targetQuaternion: THREE.Quaternion
  targetScale: number
}

export type LayoutEntry = AlignmentEntry & {
  fromOutlineOpacity: number
  fromOutlinePosition: THREE.Vector3
  fromOutlineScale: number
}
