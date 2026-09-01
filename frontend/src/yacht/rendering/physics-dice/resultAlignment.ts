import * as THREE from 'three'
import { PHYSICS_DICE_CONFIG } from './config'
import {
  occupiedKeepSlotCount,
  lineUpDice as placeDice,
  positionKeepSlots,
  prepareAlignmentEntries,
  prepareLayoutEntries,
  resultCameraWidth,
  updateAlignmentEntries,
  updateLayoutEntries,
} from './layout'
import type { AlignmentEntry, DieEntry, LayoutEntry } from './runtimeTypes'
import type { PhysicsDiceIndex, PhysicsDiceSet, PhysicsHeldDice } from './types'

const SCENE = PHYSICS_DICE_CONFIG.scene

/** 정렬이 만지는 것들. 월드가 자기 것을 그대로 넘긴다. */
export interface AlignmentScene {
  readonly entries: readonly DieEntry[]
  readonly held: PhysicsHeldDice
  readonly heldOrder: PhysicsDiceIndex[]
  readonly keepAll: boolean
  readonly keepSlots: THREE.Group[]
  readonly keepSlotMaterials: THREE.Material[]
}

/**
 * 굴림이 끝난 뒤 주사위를 결과 줄로 옮기기 시작한다.
 *
 * 킵 자리는 **잡은 개수만큼만** 먼저 세운다 — 이 순간에는 방금 굴린 주사위가 아직
 * 결과 줄로 가는 중이라, 다섯 자리를 미리 그리면 빈 칸이 먼저 보인다.
 */
export function beginResultAlignment(
  scene: AlignmentScene,
  settledDice: PhysicsDiceSet,
): AlignmentEntry[] {
  const entries = prepareAlignmentEntries(
    [...scene.entries],
    scene.held,
    scene.heldOrder,
    settledDice,
    scene.keepAll,
  )
  positionKeepSlots(
    scene.keepSlots,
    Math.min(scene.heldOrder.length, slotCount(scene)),
    scene.keepSlotMaterials,
  )
  return entries
}

/**
 * 정렬 한 프레임. 카메라는 시뮬레이션 폭에서 결과 폭으로 함께 좁혀진다.
 *
 * @returns 진행도(1이면 끝)와 이번 프레임의 카메라 반폭.
 */
export function stepResultAlignment(params: {
  readonly alignmentEntries: AlignmentEntry[]
  readonly time: number
  readonly startedAt: number
}): { readonly progress: number; readonly cameraHorizontal: number } {
  const progress = Math.min(1, (params.time - params.startedAt) / SCENE.alignment.durationMs)
  const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2
  updateAlignmentEntries(params.alignmentEntries, progress)
  return {
    progress,
    cameraHorizontal: THREE.MathUtils.lerp(
      SCENE.camera.simulationHalfWidth,
      resultCameraWidth(),
      eased,
    ),
  }
}

/** 정렬이 끝났다. 킵 자리를 최종 개수로 세우고 재생용 오프셋을 지운다. */
export function completeResultAlignment(scene: AlignmentScene): void {
  positionKeepSlots(scene.keepSlots, slotCount(scene), scene.keepSlotMaterials)
  scene.entries.forEach((entry) => {
    entry.visualOffset.identity()
  })
}

const slotCount = (scene: AlignmentScene): number =>
  occupiedKeepSlotCount(scene.keepAll, scene.keepSlots.length, scene.heldOrder.length)

/**
 * 킵 상태가 바뀌었을 때의 자리 이동. 굴리는 중이 아니라 **결과 줄이 서 있는 동안**
 * 일어나는 전환이라, 물리를 돌리지 않고 목표 위치로 보간만 한다.
 *
 * 그릇을 물리 세계 밖으로 치우는 것도 여기서 한다 — 결과 줄에서는 그릇이 보이지
 * 않아야 하고, 몸체가 남아 있으면 주사위가 보이지 않는 벽에 부딪힌다.
 */
export function beginLayoutTransition(
  scene: AlignmentScene & {
    readonly committedDice: PhysicsDiceSet
    readonly bowlGroup: THREE.Group
    readonly bowlBody: { setTranslation(t: THREE.Vector3Like, wake: boolean): void }
  },
): LayoutEntry[] {
  scene.bowlGroup.visible = false
  scene.bowlBody.setTranslation({ x: 10, y: -5, z: 0 }, false)
  return prepareLayoutEntries(
    [...scene.entries],
    scene.held,
    scene.heldOrder,
    scene.committedDice,
    scene.keepAll,
  )
}

/** 자리 이동 한 프레임. @returns 아직 움직이는 중인지. */
export function stepLayoutTransition(params: {
  readonly layoutEntries: LayoutEntry[]
  readonly time: number
  readonly startedAt: number
}): boolean {
  const progress = Math.min(
    1,
    (params.time - params.startedAt) / PHYSICS_DICE_CONFIG.scene.keepSlots.moveDurationMs,
  )
  updateLayoutEntries(params.layoutEntries, progress)
  return progress < 1
}

/**
 * 결과 줄을 곧바로 세운다(애니메이션 없이). 굴림 없이 킵만 바뀌었거나 재접속으로
 * 확정된 눈을 그대로 받았을 때의 경로다.
 */
export function placeDiceInResultRow(
  scene: AlignmentScene & {
    readonly committedDice: PhysicsDiceSet
    readonly bowlGroup: THREE.Group
    readonly bowlBody: { setTranslation(t: THREE.Vector3Like, wake: boolean): void }
  },
): void {
  scene.bowlGroup.visible = false
  scene.bowlBody.setTranslation({ x: 10, y: -5, z: 0 }, false)
  placeDice([...scene.entries], scene.held, scene.heldOrder, scene.committedDice, scene.keepAll)
  positionKeepSlots(scene.keepSlots, slotCount(scene), scene.keepSlotMaterials)
}
