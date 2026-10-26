import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { easedTilt } from './bowlMotion'
import type { BowlRig } from './bowlRig'
import { PHYSICS_DICE_CONFIG } from './config'
import {
  positionKeepSlots,
  prepareAlignmentEntries,
  resultCameraWidth,
  updateAlignmentEntries,
} from './layout'
import { type DiceTrajectoryPlan, planDiceTrajectory } from './remap'
import type { AlignmentEntry, DieEntry } from './runtimeTypes'
import {
  applyTrajectoryOffset,
  applyTrajectoryPose,
  commitTrajectoryPose,
  detectTrajectoryImpacts,
  trajectoryStep,
} from './trajectory'
import type {
  PhysicsDiceIndex,
  PhysicsDiceRollRequest,
  PhysicsDiceSet,
  PhysicsDiceWorldCallbacks,
  PhysicsHeldDice,
} from './types'

/**
 * 던지기의 **궤적 재생과 결과 정렬** — 한 번의 굴림이 끝나는 두 단계를 소유한다.
 *
 * `World.ts`에서 갈라 둔 이유: 월드는 무대·사발·레이아웃·입력을 조정하는 오케스트레이터
 * 이고, 이 클래스는 "사발이 열린 뒤 녹화한 궤적을 재생하고 목표 면으로 세운다"는 한 줄기
 * 절차의 상태(재생 위치·정렬 시작 시각·목표 면)를 들고 있다. 월드는 배우가 아니라
 * 무대·콜백·좌석 배치만 빌려 준다.
 */

const SCENE = PHYSICS_DICE_CONFIG.scene
const NO_PHASE = 'idle' as const

/** 재생이 월드에 요구하는 것 — 상태는 이 클래스가, 화면 자원은 월드가 소유한다. */
export interface ReplayStage {
  readonly entries: DieEntry[]
  readonly held: PhysicsHeldDice
  readonly callbacks: PhysicsDiceWorldCallbacks
  readonly bowlRig: BowlRig
  readonly keepSlots: THREE.Group[]
  readonly keepSlotMaterials: THREE.Material[]
  readonly heldOrder: PhysicsDiceIndex[]
  readonly keepAll: boolean
  readonly committedDice: PhysicsDiceSet
  setCommittedDice(dice: PhysicsDiceSet): void
  setCameraHorizontal(value: number): void
  setPhase(phase: 'aligning' | 'idle'): void
  resize(): void
  invalidate(): void
}

export class RollReplay {
  private request: PhysicsDiceRollRequest | null = null
  private trajectory: DiceTrajectoryPlan | null = null
  private trajectoryFrameIndex = 0
  private trajectoryStartedAt = 0
  private alignmentEntries: AlignmentEntry[] = []
  private alignmentStartedAt = 0
  private settledDice: PhysicsDiceSet | null = null
  private readonly fallingDice = [false, false, false, false, false]
  private readonly lastImpactAt = [0, 0, 0, 0, 0]

  constructor(private readonly stage: ReplayStage) {}

  /** 새 굴림 — 이전 재생 상태를 모두 버린다. */
  begin(request: PhysicsDiceRollRequest): void {
    this.request = request
    this.trajectory = null
    this.trajectoryFrameIndex = 0
    this.settledDice = null
    this.fallingDice.fill(false)
    this.lastImpactAt.fill(0)
  }

  /** 재생 중인가 — 프레임 루프가 시뮬레이션 여부를 판단할 때 쓴다. */
  get replaying(): boolean {
    return this.trajectory !== null
  }

  /**
   * 사발이 열렸다 → 궤적을 계획하고 재생을 시작한다.
   *
   * 계획이 실패하면 **연출만 생략**하고 오류를 알린다(값은 서버 권위라 이미 확정이다).
   */
  start(world: RAPIER.World): void {
    const request = this.request
    if (!request) return
    const trajectory = planDiceTrajectory(world, this.stage.entries, this.stage.held, request.seed)
    if (!trajectory) {
      this.stage.callbacks.onError(new Error('주사위 궤적을 계산하지 못했습니다.'))
      return
    }
    this.trajectory = trajectory
    this.trajectoryStartedAt = performance.now()
    applyTrajectoryOffset(
      this.stage.entries,
      this.stage.held,
      request.targetDice,
      trajectory.naturalDice,
    )
    for (const entry of this.stage.entries) {
      if (this.stage.held[entry.index]) continue
      entry.body.setBodyType(RAPIER.RigidBodyType.Fixed, true)
    }
  }

  /** 매 프레임 궤적을 따라 이동. 끝나면 결과 정렬로 넘긴다. */
  updateTrajectory(time: number): void {
    const trajectory = this.trajectory
    if (!trajectory) return
    const step = trajectoryStep(
      trajectory,
      this.trajectoryStartedAt,
      this.trajectoryFrameIndex,
      time,
    )
    this.trajectoryFrameIndex = step.frameIndex
    const impacts = detectTrajectoryImpacts({
      entries: this.stage.entries,
      falling: this.fallingDice,
      held: this.stage.held,
      lastImpactAt: this.lastImpactAt,
      step,
      time,
    })
    for (const impact of impacts) {
      this.stage.callbacks.onDiceImpact?.(impact.index, impact.strength)
    }
    applyTrajectoryPose(step, this.stage.entries, this.stage.held)
    if (step.elapsed < trajectory.durationSeconds) return
    commitTrajectoryPose(this.stage.entries, this.stage.held)
    this.trajectory = null
    this.startAlignment(time)
  }

  /** 목표 면이 위로 오도록 세우는 연출의 시작. */
  startAlignment(time: number): void {
    if (!this.request) return
    this.stage.setPhase('aligning')
    this.stage.callbacks.onPhaseChange('aligning')
    this.alignmentStartedAt = time
    this.settledDice = [...this.request.targetDice]
    this.alignmentEntries = prepareAlignmentEntries(this.layoutInput(), this.settledDice)
    positionKeepSlots(
      this.stage.keepSlots,
      Math.min(this.stage.heldOrder.length, this.keptCount()),
      this.stage.keepSlotMaterials,
    )
  }

  /** 정렬 연출 프레임. 끝나면 커밋하고 `onRollComplete`를 부른다. */
  updateAlignment(time: number): void {
    const progress = Math.min(1, (time - this.alignmentStartedAt) / SCENE.alignment.durationMs)
    const eased = easedTilt(progress)
    this.stage.setCameraHorizontal(
      THREE.MathUtils.lerp(SCENE.camera.simulationHalfWidth, resultCameraWidth(), eased),
    )
    this.stage.resize()
    updateAlignmentEntries(this.alignmentEntries, progress)
    this.stage.bowlRig.updateExit(time)
    if (progress < 1 || !this.request || !this.settledDice) return
    const completed = this.request
    const completedDice = this.settledDice
    this.stage.setCommittedDice([...completedDice])
    positionKeepSlots(this.stage.keepSlots, this.keptCount(), this.stage.keepSlotMaterials)
    for (const entry of this.stage.entries) entry.visualOffset.identity()
    this.request = null
    this.stage.setPhase('idle')
    this.stage.callbacks.onPhaseChange('idle')
    this.stage.callbacks.onRollComplete(completed.requestId, completedDice)
  }

  private keptCount(): number {
    return this.stage.keepAll ? this.stage.keepSlots.length : this.stage.heldOrder.length
  }

  private layoutInput() {
    return {
      entries: this.stage.entries,
      held: this.stage.held,
      heldOrder: this.stage.heldOrder,
      keepAll: this.stage.keepAll,
    }
  }
}

/** 위상 이름은 월드와 공유한다 — 문자열이 두 곳에 흩어지지 않게. */
export type { NO_PHASE }
