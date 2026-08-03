import * as THREE from 'three'
import type { DieEntry } from './runtimeTypes'
import type { PhysicsDiceIndex } from './types'

export function pickDie(
  event: PointerEvent,
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
  entries: DieEntry[],
): PhysicsDiceIndex | null {
  const bounds = renderer.domElement.getBoundingClientRect()
  const pointer = new THREE.Vector2(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
  )
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(pointer, camera)
  const hit = raycaster.intersectObjects(
    entries.map((entry) => entry.mesh),
    true,
  )[0]
  let target: THREE.Object3D | null = hit?.object ?? null
  while (target && target.userData.dieIndex == null) target = target.parent
  const index = target?.userData.dieIndex
  return typeof index === 'number' && index >= 0 && index <= 4 ? (index as PhysicsDiceIndex) : null
}
