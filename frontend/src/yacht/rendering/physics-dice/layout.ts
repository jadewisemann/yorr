import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { PHYSICS_DICE_CONFIG } from './config'
import { quaternionForTopValue } from './model'
import type { AlignmentEntry, DieEntry, LayoutEntry } from './runtimeTypes'
import type { PhysicsDiceIndex, PhysicsDiceSet, PhysicsHeldDice } from './types'

const SCENE = PHYSICS_DICE_CONFIG.scene
const BASE_SIZE = SCENE.baseDiceSize

export function keepSlotPosition(index: number) {
  return new THREE.Vector3(
    (index - 2) * keepSlotSpacing(),
    (PHYSICS_DICE_CONFIG.defaults.diceSize * SCENE.keepSlots.diceScale) / 2 + 0.025,
    SCENE.tray.slotZ,
  )
}

export function keepSlotScale() {
  return (PHYSICS_DICE_CONFIG.defaults.diceSize / BASE_SIZE) * SCENE.keepSlots.diceScale
}

export function keepSlotSpacing() {
  const size = PHYSICS_DICE_CONFIG.defaults.diceSize * SCENE.keepSlots.diceScale
  return (
    size * (1 + 2 * (SCENE.keepSlots.borderOffsetRatio + SCENE.keepSlots.borderWidthRatio)) +
    size * SCENE.keepSlots.gapRatio
  )
}

export function simulationDieScale() {
  return (PHYSICS_DICE_CONFIG.defaults.diceSize / BASE_SIZE) * SCENE.bowlDiceScale
}

export function resultDieScale() {
  return (PHYSICS_DICE_CONFIG.defaults.diceSize / BASE_SIZE) * SCENE.resultDiceScale
}

export function resultSpacing() {
  return PHYSICS_DICE_CONFIG.defaults.diceSize * SCENE.resultDiceScale + SCENE.resultGap
}

export function resultCenterY() {
  return (PHYSICS_DICE_CONFIG.defaults.diceSize * SCENE.resultDiceScale) / 2 + 0.025
}

export function resultCameraWidth() {
  const required =
    resultSpacing() * 2 + (PHYSICS_DICE_CONFIG.defaults.diceSize * SCENE.resultDiceScale) / 2 + 0.3
  return Math.max(SCENE.camera.resultHalfWidth, required)
}

export function tiltedBowlPosition(progress: number, angle: number) {
  return {
    x:
      THREE.MathUtils.lerp(SCENE.bowl.startX, SCENE.bowl.pourX, progress) +
      Math.sin(angle) * SCENE.bowl.rotationPivotY +
      progress * SCENE.bowl.tiltTravelX,
    y:
      SCENE.bowl.rotationPivotY * (1 - Math.cos(angle)) +
      SCENE.bowl.hoverY +
      progress * SCENE.bowl.tiltLiftY,
    z:
      THREE.MathUtils.lerp(SCENE.bowl.startZ, SCENE.bowl.pourZ, progress) +
      progress * SCENE.bowl.tiltTravelZ,
  }
}

interface DicePlacement {
  onKeepRail: boolean
  position: THREE.Vector3
  scale: number
  slotIndex: number
}

function planDicePlacements(
  entries: DieEntry[],
  held: PhysicsHeldDice,
  heldOrder: PhysicsDiceIndex[],
  keepAll: boolean,
) {
  const railOrder = keepAll
    ? [...heldOrder, ...entries.map((entry) => entry.index).filter((index) => !held[index])]
    : heldOrder
  const heldSlots = new Map(railOrder.map((index, slot) => [index, slot]))
  const rowIndices = entries
    .filter((entry) => !keepAll && !held[entry.index])
    .map((entry) => entry.index)

  return new Map<number, DicePlacement>(
    entries.map((entry) => {
      const onKeepRail = keepAll || held[entry.index]
      const slotIndex = heldSlots.get(entry.index) ?? 0
      const row = rowIndices.indexOf(entry.index)
      return [
        entry.index,
        {
          onKeepRail,
          slotIndex,
          position: onKeepRail
            ? keepSlotPosition(slotIndex)
            : new THREE.Vector3(
                (row - (rowIndices.length - 1) / 2) * resultSpacing(),
                resultCenterY(),
                SCENE.tray.resultRowZ,
              ),
          scale: onKeepRail ? keepSlotScale() : resultDieScale(),
        },
      ]
    }),
  )
}

function placementOf(placements: Map<number, DicePlacement>, index: number): DicePlacement {
  const placement = placements.get(index)
  if (!placement) throw new Error(`주사위 ${index}의 배치를 계산하지 못했습니다`)
  return placement
}

export function positionKeepSlots(
  slots: THREE.Group[],
  heldCount: number,
  materials: THREE.Material[],
) {
  const [occupied, empty] = materials
  slots.forEach((slot, index) => {
    const position = keepSlotPosition(index)
    slot.position.set(position.x, 0.018, position.z)
    const scale = keepSlotScale()
    slot.scale.set(scale, scale, 1)
    const bar = slot.children[0]
    if (bar instanceof THREE.Mesh && occupied && empty) {
      bar.material = index < heldCount ? occupied : empty
    }
  })
}

export function lineUpDice(
  entries: DieEntry[],
  held: PhysicsHeldDice,
  heldOrder: PhysicsDiceIndex[],
  committedDice: PhysicsDiceSet,
  keepAll = false,
) {
  const placements = planDicePlacements(entries, held, heldOrder, keepAll)
  entries.forEach((entry) => {
    const { onKeepRail, position, scale } = placementOf(placements, entry.index)
    const targetQuaternion = quaternionForTopValue(committedDice[entry.index])
    entry.mesh.visible = true
    entry.mesh.position.copy(position)
    entry.mesh.quaternion.copy(targetQuaternion)
    entry.mesh.scale.setScalar(scale)
    entry.body.setBodyType(RAPIER.RigidBodyType.Fixed, true)
    entry.body.setTranslation(position, true)
    entry.body.setRotation(entry.mesh.quaternion, true)
    entry.outline.position.set(position.x, 0.04, position.z)
    entry.outline.scale.set(scale, scale, 1)
    entry.outline.visible = true
    entry.outline.material.opacity = onKeepRail ? 0.92 : 0.12
  })
}

export function prepareLayoutEntries(
  entries: DieEntry[],
  held: PhysicsHeldDice,
  heldOrder: PhysicsDiceIndex[],
  committedDice: PhysicsDiceSet,
  keepAll = false,
): LayoutEntry[] {
  const placements = planDicePlacements(entries, held, heldOrder, keepAll)
  return entries.map((entry) => {
    const {
      onKeepRail,
      position: targetPosition,
      scale: targetScale,
      slotIndex,
    } = placementOf(placements, entry.index)
    const targetQuaternion = quaternionForTopValue(committedDice[entry.index])
    entry.body.setBodyType(RAPIER.RigidBodyType.Fixed, true)
    entry.body.setTranslation(targetPosition, true)
    entry.body.setRotation(targetQuaternion, true)
    entry.outline.visible = true
    return {
      entry,
      held: onKeepRail,
      slotIndex,
      targetPosition,
      targetQuaternion,
      targetScale,
      fromPosition: entry.mesh.position.clone(),
      fromQuaternion: entry.mesh.quaternion.clone(),
      fromScale: entry.mesh.scale.x,
      fromOutlinePosition: entry.outline.position.clone(),
      fromOutlineScale: entry.outline.scale.x,
      fromOutlineOpacity: entry.outline.material.opacity,
    }
  })
}

export function updateLayoutEntries(entries: LayoutEntry[], progress: number) {
  const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2
  entries.forEach((item) => {
    item.entry.mesh.position.lerpVectors(item.fromPosition, item.targetPosition, eased)
    item.entry.mesh.quaternion.slerpQuaternions(item.fromQuaternion, item.targetQuaternion, eased)
    item.entry.mesh.scale.setScalar(THREE.MathUtils.lerp(item.fromScale, item.targetScale, eased))
    item.entry.outline.position.lerpVectors(
      item.fromOutlinePosition,
      new THREE.Vector3(item.targetPosition.x, 0.04, item.targetPosition.z),
      eased,
    )
    const outlineScale = THREE.MathUtils.lerp(item.fromOutlineScale, item.targetScale, eased)
    item.entry.outline.scale.set(outlineScale, outlineScale, 1)
    item.entry.outline.material.opacity = THREE.MathUtils.lerp(
      item.fromOutlineOpacity,
      item.held ? 0.92 : 0.12,
      eased,
    )
  })
}

export function prepareAlignmentEntries(
  entries: DieEntry[],
  held: PhysicsHeldDice,
  heldOrder: PhysicsDiceIndex[],
  settledDice: PhysicsDiceSet,
  keepAll = false,
): AlignmentEntry[] {
  const placements = planDicePlacements(entries, held, heldOrder, keepAll)
  return entries.map((entry) => {
    const {
      onKeepRail,
      position: targetPosition,
      scale: targetScale,
      slotIndex,
    } = placementOf(placements, entry.index)
    const targetQuaternion = quaternionForTopValue(settledDice[entry.index])
    entry.body.setBodyType(RAPIER.RigidBodyType.Fixed, true)
    entry.body.setTranslation(targetPosition, true)
    entry.body.setRotation(targetQuaternion, true)
    return {
      entry,
      held: onKeepRail,
      slotIndex,
      targetPosition,
      targetQuaternion,
      targetScale,
      fromPosition: entry.mesh.position.clone(),
      fromQuaternion: entry.mesh.quaternion.clone(),
      fromScale: entry.mesh.scale.x,
    }
  })
}

export function updateAlignmentEntries(entries: AlignmentEntry[], progress: number) {
  const lineUpProgress = Math.min(1, progress / SCENE.alignment.lineUpEnd)
  const scaleProgress = lineUpProgress
  const lineUpEased = easeInOut(lineUpProgress)
  const scaleEased = easeInOut(scaleProgress)
  const lift = Math.sin(lineUpProgress * Math.PI) * SCENE.alignment.lift

  entries.forEach((item) => {
    item.entry.mesh.position.lerpVectors(item.fromPosition, item.targetPosition, lineUpEased)
    if (!item.held) item.entry.mesh.position.y += lift
    item.entry.mesh.quaternion.slerpQuaternions(
      item.fromQuaternion,
      item.targetQuaternion,
      lineUpEased,
    )
    const scale = THREE.MathUtils.lerp(item.fromScale, item.targetScale, scaleEased)
    item.entry.mesh.scale.setScalar(scale)
    item.entry.outline.visible = item.held || scaleProgress > 0.3
    item.entry.outline.position.set(item.entry.mesh.position.x, 0.04, item.entry.mesh.position.z)
    item.entry.outline.scale.set(scale, scale, 1)
    item.entry.outline.material.opacity = item.held
      ? 0.92
      : Math.max(0, 0.12 * ((scaleProgress - 0.3) / 0.7))
  })
}

function easeInOut(progress: number) {
  return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2
}
