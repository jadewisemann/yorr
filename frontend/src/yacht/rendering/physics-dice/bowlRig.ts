import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { applyShakeKick, applyShakePulse, bowlShakePose, easedTilt } from './bowlMotion'
import { PHYSICS_DICE_CONFIG } from './config'
import { tiltedBowlPosition } from './layout'
import type { PhysicsDiceRandom } from './random'
import type { DieEntry } from './runtimeTypes'
import type { PhysicsHeldDice } from './types'

/**
 * 사발 하나의 시간축 — 흔들기 → 쏟기 → 퇴장.
 *
 * 왜 분리했나: `PhysicsDiceWorld`는 "지금 어느 단계인가"만 알면 되고, 사발의 위치·회전·펄스
 * 에너지는 그 안에서만 쓰인다. 이 클래스가 사발의 시계와 기하를 소유하면 World의 프레임 루프는
 * `updateBowl(time)` 한 줄로 남는다.
 */

const CONFIG = PHYSICS_DICE_CONFIG
const SCENE = CONFIG.scene

export interface BowlRigDeps {
  bowlBody: RAPIER.RigidBody
  bowlGroup: THREE.Group
  bowlInner: THREE.Mesh
  entries: DieEntry[]
  held: () => PhysicsHeldDice
  random: () => PhysicsDiceRandom
}

export class BowlRig {
  private exitStartedAt = 0
  private lastPulseAt = 0
  private lastShakeKick = 0
  private motionFollow = false
  private pourStartedAt = 0
  private released = false
  private shakeEnergy = 0
  private shakeStartedAt = 0

  constructor(private readonly deps: BowlRigDeps) {}

  /** 굴림 시작 — 사발을 띄우고 시계를 0으로 맞춘다. */
  start(time: number) {
    this.shakeStartedAt = time
    this.lastShakeKick = 0
    this.shakeEnergy = this.motionFollow ? SCENE.bowl.followStartEnergy : 0
    this.lastPulseAt = time
    this.released = false
    const { bowlBody, bowlGroup, bowlInner } = this.deps
    bowlGroup.visible = true
    bowlGroup.position.set(SCENE.bowl.startX, SCENE.bowl.hoverY, SCENE.bowl.startZ)
    bowlGroup.rotation.set(0, 0, 0)
    bowlInner.visible = true
    bowlBody.setTranslation(
      { x: SCENE.bowl.startX, y: SCENE.bowl.hoverY, z: SCENE.bowl.startZ },
      true,
    )
    bowlBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)
  }

  /** 쏟기로 넘어간다. 흔들기 중이 아니면 무시한다. */
  pour(phase: string, time: number): boolean {
    if (phase !== 'shaking') return false
    this.pourStartedAt = time
    this.exitStartedAt = time + SCENE.bowl.tiltDurationMs
    return true
  }

  setMotionFollow(enabled: boolean) {
    this.motionFollow = enabled
  }

  /** 기기 기울임 펄스. 흔들기 중이 아니면 세기만 갱신하고 무시한다. */
  pulse(direction: 'left' | 'right', strength: number, now: number, active: boolean): boolean {
    if (!active || !this.motionFollow) return false
    const clamped = Math.min(1, Math.max(0, strength))
    this.shakeEnergy = Math.min(
      1,
      Math.max(
        this.currentShakeIntensity(now),
        SCENE.bowl.followPulseFloor + clamped * SCENE.bowl.followPulseGain,
      ),
    )
    this.lastPulseAt = now
    applyShakePulse({
      entries: this.deps.entries,
      held: this.deps.held(),
      random: this.deps.random(),
      sign: direction === 'left' ? -1 : 1,
      strength: clamped,
    })
    return true
  }

  /** 사발을 감춘다 — 결과 줄로 넘어갈 때. */
  hide() {
    this.deps.bowlGroup.visible = false
    this.deps.bowlBody.setTranslation({ x: 10, y: -5, z: 0 }, false)
  }

  /** 퇴장이 끝났는가 — World가 프레임 루프를 멈출지 판단한다. */
  get isReleased() {
    return this.released
  }

  /**
   * 한 프레임. 흔들기·쏟기·퇴장을 스스로 진행하고, 다 쏟았으면 `true`를 돌려준다
   * (World가 그때 궤적 재생을 시작한다).
   */
  update(time: number, phase: 'idle' | 'shaking' | 'pouring' | 'aligning'): boolean {
    if (phase === 'shaking') {
      const intensity = this.currentShakeIntensity(time) * SCENE.bowl.shakeStrength
      const pose = bowlShakePose((time - this.shakeStartedAt) / 1000, intensity)
      const { bowlBody, bowlGroup } = this.deps
      bowlBody.setNextKinematicTranslation({ x: pose.x, y: pose.y, z: pose.z })
      bowlBody.setNextKinematicRotation(pose.rotation)
      bowlGroup.position.set(pose.x, pose.y, pose.z)
      bowlGroup.rotation.y = pose.yaw
      if (intensity > 0 && time - this.lastShakeKick >= SCENE.bowl.shakeIntervalMs) {
        this.lastShakeKick = time
        applyShakeKick({
          entries: this.deps.entries,
          held: this.deps.held(),
          intensity,
          pose,
          random: this.deps.random(),
        })
      }
      return false
    }
    if (phase !== 'pouring') return false

    const progress = Math.min(1, (time - this.pourStartedAt) / SCENE.bowl.tiltDurationMs)
    const eased = easedTilt(progress)
    const angle =
      THREE.MathUtils.degToRad(SCENE.bowl.tiltDegrees) * SCENE.bowl.tiltDirection * eased
    const position = tiltedBowlPosition(eased, angle)
    const { bowlBody, bowlGroup } = this.deps
    bowlGroup.position.set(position.x, position.y, position.z)
    bowlGroup.rotation.set(0, 0, angle)
    if (progress >= 1) this.updateExit(time)
    if (this.released) return false
    if (progress >= SCENE.bowl.releaseTiltProgress) {
      this.released = true
      bowlBody.setTranslation({ x: 10, y: -5, z: 0 }, true)
      return true
    }
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle)
    bowlBody.setNextKinematicTranslation(position)
    bowlBody.setNextKinematicRotation(rotation)
    return false
  }

  /** 결과 정렬 중에도 사발은 화면 밖으로 빠져나간다. */
  updateExit(time: number) {
    const { bowlGroup } = this.deps
    if (!bowlGroup.visible) return
    const progress = Math.min(1, (time - this.exitStartedAt) / SCENE.bowl.exitDurationMs)
    const eased = 1 - (1 - progress) ** 3
    const angle = THREE.MathUtils.degToRad(SCENE.bowl.tiltDegrees) * SCENE.bowl.tiltDirection
    const tipped = tiltedBowlPosition(1, angle)
    bowlGroup.position.set(
      tipped.x + SCENE.bowl.spillPushTravelX + eased * SCENE.bowl.exitTravelX,
      tipped.y + eased * SCENE.bowl.exitLiftY,
      tipped.z,
    )
    if (progress >= 1) bowlGroup.visible = false
  }

  private currentShakeIntensity(time: number) {
    if (!this.motionFollow) return 1
    if (this.shakeEnergy <= 0) return 0
    const decayed =
      this.shakeEnergy * Math.exp(-(time - this.lastPulseAt) / SCENE.bowl.followDecayMs)
    return decayed < SCENE.bowl.followMinIntensity ? 0 : decayed
  }
}
