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
  /** 큐브 대칭 회전 — 물리 바디는 그대로 두고 표시 면만 목표값으로 바꾼다. */
  visualOffset: THREE.Quaternion
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
