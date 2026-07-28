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

/** 사발은 흔들던 자리(start)에서 기울어지는 동안 쏟는 위치(pour)까지 미끄러진다 —
 *  쏟으면서 오른쪽으로 빠져나가는 한 호흡의 동작이고, 퇴장 애니메이션이 그대로 이어받는다. */
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
    // 킵된 주사위가 앉은 슬롯의 바만 악센트로 — "킵 = 위치"를 색으로 한 번 더 말한다.
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
) {
  const heldSlots = new Map(heldOrder.map((index, slot) => [index, slot]))
  const rollingIndices = entries.filter((entry) => !held[entry.index]).map((entry) => entry.index)
  entries.forEach((entry) => {
    const isHeld = held[entry.index]
    const row = rollingIndices.indexOf(entry.index)
    const position = isHeld
      ? keepSlotPosition(heldSlots.get(entry.index) ?? 0)
      : new THREE.Vector3(
          (row - (rollingIndices.length - 1) / 2) * resultSpacing(),
          resultCenterY(),
          SCENE.tray.resultRowZ,
        )
    const scale = isHeld ? keepSlotScale() : resultDieScale()
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
    entry.outline.material.opacity = isHeld ? 0.92 : 0.12
  })
}

export function prepareLayoutEntries(
  entries: DieEntry[],
  held: PhysicsHeldDice,
  heldOrder: PhysicsDiceIndex[],
  committedDice: PhysicsDiceSet,
): LayoutEntry[] {
  const heldSlots = new Map(heldOrder.map((index, slot) => [index, slot]))
  const rolling = entries.filter((entry) => !held[entry.index]).map((entry) => entry.index)
  return entries.map((entry) => {
    const isHeld = held[entry.index]
    const slotIndex = heldSlots.get(entry.index) ?? 0
    const row = rolling.indexOf(entry.index)
    const targetPosition = isHeld
      ? keepSlotPosition(slotIndex)
      : new THREE.Vector3(
          (row - (rolling.length - 1) / 2) * resultSpacing(),
          resultCenterY(),
          SCENE.tray.resultRowZ,
        )
    const targetScale = isHeld ? keepSlotScale() : resultDieScale()
    const targetQuaternion = quaternionForTopValue(committedDice[entry.index])
    entry.body.setBodyType(RAPIER.RigidBodyType.Fixed, true)
    entry.body.setTranslation(targetPosition, true)
    entry.body.setRotation(targetQuaternion, true)
    entry.outline.visible = true
    return {
      entry,
      held: isHeld,
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
): AlignmentEntry[] {
  const rolling = entries.filter((entry) => !held[entry.index])
  const heldSlots = new Map(heldOrder.map((index, slot) => [index, slot]))
  return entries.map((entry) => {
    const isHeld = held[entry.index]
    const slotIndex = heldSlots.get(entry.index) ?? 0
    const row = rolling.indexOf(entry)
    const targetPosition = isHeld
      ? keepSlotPosition(slotIndex)
      : new THREE.Vector3(
          (row - (rolling.length - 1) / 2) * resultSpacing(),
          resultCenterY(),
          SCENE.tray.resultRowZ,
        )
    const targetQuaternion = quaternionForTopValue(settledDice[entry.index])
    entry.body.setBodyType(RAPIER.RigidBodyType.Fixed, true)
    entry.body.setTranslation(targetPosition, true)
    entry.body.setRotation(targetQuaternion, true)
    return {
      entry,
      held: isHeld,
      slotIndex,
      targetPosition,
      targetQuaternion,
      targetScale: isHeld ? keepSlotScale() : resultDieScale(),
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
