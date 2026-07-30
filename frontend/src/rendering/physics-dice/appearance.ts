import * as THREE from 'three'
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
  const styles = getComputedStyle(document.documentElement)
  const color = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
  resources.materials.die.color.set(color('--ds-color-physics-die', '#e7e9df'))
  resources.materials.dark.color.set(color('--ds-color-physics-pip', '#171b18'))
  resources.materials.red.color.set(color('--ds-color-physics-danger', '#ff523f'))
  resources.railMaterial.color.set(color('--ds-color-physics-rail', '#1e2941'))
  resources.railLineMaterial.color.set(color('--ds-color-physics-accent', '#c6f640'))
  resources.bowlInnerMaterial.color
    .set(color('--ds-color-physics-danger', '#ff523f'))
    .multiplyScalar(0.42)
  resources.ambient.groundColor.set(0x1a1b1e)
  resources.entries.forEach((entry) => {
    entry.outline.material.color.set(color('--ds-color-physics-accent', '#c6f640'))
  })
  const [occupied, empty] = resources.keepSlotMaterials
  if (occupied instanceof THREE.MeshBasicMaterial)
    occupied.color.set(color('--ds-color-physics-accent', '#c6f640'))
  if (empty instanceof THREE.MeshBasicMaterial)
    empty.color.set(color('--ds-color-physics-slot', '#42516e'))
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
