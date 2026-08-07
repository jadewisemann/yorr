import * as THREE from 'three'
import { dsColorReader } from '@/styles/tokenFallbacks'
import type { PhysicsDiceGeometries, PhysicsDiceMaterials } from './model'
import type { DieEntry } from './runtimeTypes'

export interface AppearanceResources {
  ambient: THREE.HemisphereLight
  bowlInnerMaterial: THREE.MeshStandardMaterial
  bowlMaterials: THREE.Material[]
  entries: DieEntry[]
  geometries: PhysicsDiceGeometries
  keepSlotMaterials: THREE.Material[]
  materials: PhysicsDiceMaterials
  railMaterial: THREE.MeshBasicMaterial
  railLineMaterial: THREE.MeshBasicMaterial
  trayMaterials: THREE.Material[]
}

export function syncAppearance(resources: AppearanceResources) {
  const color = dsColorReader()
  resources.materials.die.color.set(color('--ds-color-physics-die'))
  resources.materials.dark.color.set(color('--ds-color-physics-pip'))
  resources.materials.red.color.set(color('--ds-color-physics-danger'))
  resources.railMaterial.color.set(color('--ds-color-physics-rail'))
  resources.railLineMaterial.color.set(color('--ds-color-physics-accent'))
  resources.bowlInnerMaterial.color.set(color('--ds-color-physics-danger')).multiplyScalar(0.42)
  resources.ambient.groundColor.set(0x1a1b1e)
  resources.entries.forEach((entry) => {
    entry.outline.material.color.set(color('--ds-color-physics-accent'))
  })
  const [occupied, empty] = resources.keepSlotMaterials
  if (occupied instanceof THREE.MeshBasicMaterial)
    occupied.color.set(color('--ds-color-physics-accent'))
  if (empty instanceof THREE.MeshBasicMaterial) empty.color.set(color('--ds-color-physics-slot'))
}

export function disposeAppearance(
  resources: AppearanceResources,
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
) {
  Object.values(resources.geometries).forEach((geometry) => {
    geometry.dispose()
  })
  Object.values(resources.materials).forEach((material) => {
    material.dispose()
  })
  resources.entries.forEach((entry) => {
    entry.outline.material.dispose()
  })
  resources.keepSlotMaterials.forEach((material) => {
    material.dispose()
  })
  resources.bowlMaterials.forEach((material) => {
    material.dispose()
  })
  resources.trayMaterials.forEach((material) => {
    material.dispose()
  })
  scene.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      !Object.values(resources.geometries).includes(object.geometry as never)
    ) {
      object.geometry.dispose()
    }
  })
  renderer.renderLists.dispose()
  renderer.dispose()
  renderer.forceContextLoss()
}
