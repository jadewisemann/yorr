import type * as THREE from 'three'
import { PHYSICS_DICE_CONFIG } from './config'
import {
  lineUpDice as placeDice,
  positionKeepSlots,
  prepareLayoutEntries,
  resultCameraWidth,
  updateLayoutEntries,
} from './layout'
import type { DieEntry, LayoutEntry } from './runtimeTypes'
import type { PhysicsDiceIndex, PhysicsDiceSet, PhysicsHeldDice } from './types'

/**
 * 결과 주사위의 **좌석 배치** — 줄 세우기와 킵 슬롯 이동 연출.
 *
 * `World.ts`에서 갈라 둔 이유: 무대·물리·입력을 조정하는 월드와 달리 이쪽은 "확정된
 * 주사위를 어디에 어떻게 놓는가"만 안다. 연출 길이(`keepSlots.moveDurationMs`)와
 * 카메라 폭 계산이 한 파일에 모여 있으면 배치 규칙을 바꿀 때 월드를 지나치지 않는다.
 */

const SCENE = PHYSICS_DICE_CONFIG.scene

export interface LayoutStage {
  readonly entries: DieEntry[]
  readonly keepSlots: THREE.Group[]
  readonly keepSlotMaterials: THREE.Material[]
  readonly held: PhysicsHeldDice
  committedDice: PhysicsDiceSet
  cameraHorizontal: number
  hideBowl(): void
  resize(): void
  invalidate(): void
}

export class ResultLayout {
  private animating = false
  private entries: LayoutEntry[] = []
  private startedAt = 0
  private heldOrder: PhysicsDiceIndex[] = []
  private keepAll = false

  constructor(private readonly stage: LayoutStage) {}

  /** 지금 배치 연출이 도는 중인가 — 프레임 루프가 판단한다. */
  get running(): boolean {
    return this.animating
  }

  get keepAllEnabled(): boolean {
    return this.keepAll
  }

  get holdOrder(): PhysicsDiceIndex[] {
    return this.heldOrder
  }

  /** 킵 플래그가 바뀌면 슬롯 순서와 점유 수를 갱신한다. */
  syncHeld(held: PhysicsHeldDice): PhysicsDiceIndex[] {
    this.heldOrder = this.heldOrder.filter((index) => held[index])
    held.forEach((isHeld, index) => {
      const dieIndex = index as PhysicsDiceIndex
      if (isHeld && !this.heldOrder.includes(dieIndex)) this.heldOrder.push(dieIndex)
    })
    return this.heldOrder
  }

  setKeepAll(enabled: boolean): boolean {
    if (this.keepAll === enabled) return false
    this.keepAll = enabled
    return true
  }

  /** 배치를 즉시 확정한다(연출 없음). */
  lineUp(): void {
    this.animating = false
    this.stage.cameraHorizontal = resultCameraWidth()
    this.stage.hideBowl()
    placeDice(this.layoutInput(), this.stage.committedDice)
    this.placeSlots(this.occupiedSlots())
    this.stage.resize()
  }

  /** 킵 변경 시의 이동 연출 시작. */
  startTransition(): void {
    this.animating = true
    this.startedAt = performance.now()
    this.stage.cameraHorizontal = resultCameraWidth()
    this.stage.hideBowl()
    this.entries = prepareLayoutEntries(this.layoutInput(), this.stage.committedDice)
    this.stage.resize()
    this.stage.invalidate()
  }

  /** 이동 연출 프레임. 끝나면 스스로 멈춘다. */
  advance(time: number): void {
    const progress = Math.min(1, (time - this.startedAt) / SCENE.keepSlots.moveDurationMs)
    updateLayoutEntries(this.entries, progress)
    if (progress >= 1) this.animating = false
  }

  /** 지금 점유해야 하는 킵 슬롯 수. */
  occupiedSlots(): number {
    return this.keepAll ? this.stage.keepSlots.length : this.heldOrder.length
  }

  /** 슬롯 표시를 갱신한다 — 배치·정렬 완료 경로가 함께 쓴다. */
  placeSlots(count: number): void {
    positionKeepSlots(this.stage.keepSlots, count, this.stage.keepSlotMaterials)
  }

  private layoutInput() {
    return {
      entries: this.stage.entries,
      held: this.stage.held,
      heldOrder: this.heldOrder,
      keepAll: this.keepAll,
    }
  }
}
