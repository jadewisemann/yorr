import type * as THREE from 'three'
import type { BowlRig } from './bowlRig'
import type { LayoutStage, ResultLayout } from './resultLayout'
import type { DieEntry } from './runtimeTypes'
import type { PhysicsDiceSet, PhysicsDiceWorldCallbacks, PhysicsHeldDice } from './types'
import type { ReplayStage } from './worldReplay'

/**
 * 월드가 배치·재생 절차에 빌려 주는 **창구 팩토리**.
 *
 * 왜 별도 파일인가: `World.ts`는 무대·물리·배치·재생의 조정자라 이미 길다. 이 두
 * 팩토리는 본질적으로 "필드 하나를 읽고 쓰는 접근자 묶음"이라 로직이 없고, 월드 본문에
 * 두면 파일 난이도만 올린다.
 *
 * 값을 복사하지 않고 **참조를 그대로 넘긴다** — `held`·`committedDice` 같은 배열은
 * 월드가 재할당하므로, 복사하면 절차가 낡은 배열을 보게 된다.
 */
export interface StageHost {
  readonly entries: DieEntry[]
  readonly keepSlots: THREE.Group[]
  readonly keepSlotMaterials: THREE.Material[]
  readonly bowlRig: BowlRig
  readonly callbacks: PhysicsDiceWorldCallbacks
  held: PhysicsHeldDice
  committedDice: PhysicsDiceSet
  cameraHorizontal: number
  phase: 'idle' | 'shaking' | 'pouring' | 'aligning'
  hideBowl(): void
  resize(): void
  invalidate(): void
}

export const createLayoutStage = (host: StageHost): LayoutStage => ({
  get entries() {
    return host.entries
  },
  get keepSlots() {
    return host.keepSlots
  },
  get keepSlotMaterials() {
    return host.keepSlotMaterials
  },
  get held() {
    return host.held
  },
  get committedDice() {
    return host.committedDice
  },
  set committedDice(value) {
    host.committedDice = value
  },
  get cameraHorizontal() {
    return host.cameraHorizontal
  },
  set cameraHorizontal(value) {
    host.cameraHorizontal = value
  },
  hideBowl: () => host.hideBowl(),
  resize: () => host.resize(),
  invalidate: () => host.invalidate(),
})

export const createReplayStage = (host: StageHost, layout: ResultLayout): ReplayStage => ({
  get entries() {
    return host.entries
  },
  get held() {
    return host.held
  },
  get callbacks() {
    return host.callbacks
  },
  get bowlRig() {
    return host.bowlRig
  },
  get keepSlots() {
    return host.keepSlots
  },
  get keepSlotMaterials() {
    return host.keepSlotMaterials
  },
  get heldOrder() {
    return layout.holdOrder
  },
  get keepAll() {
    return layout.keepAllEnabled
  },
  get committedDice() {
    return host.committedDice
  },
  setCommittedDice: (dice) => {
    host.committedDice = dice
  },
  setCameraHorizontal: (value) => {
    host.cameraHorizontal = value
  },
  setPhase: (phase) => {
    host.phase = phase
  },
  resize: () => host.resize(),
  invalidate: () => host.invalidate(),
})

/** 월드가 스스로에게 요구하는 인터페이스 하나로 묶어 둔다. */
export type { LayoutStage, ReplayStage }
