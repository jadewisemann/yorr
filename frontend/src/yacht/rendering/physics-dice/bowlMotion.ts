import * as THREE from 'three'
import { PHYSICS_DICE_CONFIG } from './config'
import { tiltedBowlPosition } from './layout'
import type { PhysicsDiceRandom } from './random'
import type { DieEntry } from './runtimeTypes'
import type { PhysicsHeldDice } from './types'

const CONFIG = PHYSICS_DICE_CONFIG
const SCENE = CONFIG.scene
const UP = new THREE.Vector3(0, 1, 0)

/**
 * 그릇의 거동 — 흔들기 · 기울여 쏟기 · 화면 밖으로 빠지기.
 *
 * 월드에서 떼어 낸 이유는 이 세 단계가 **한 프레임 안에서 끝나는 계산**이고 월드의
 * 나머지(레이아웃 · 리사이즈 · 탭 · 테마)와 상태를 나눠 갖지 않기 때문이다. 바뀌는
 * 값은 인자로 받아 돌려준다 — 월드가 자기 상태의 주인으로 남는다.
 */

export interface ShakeIntensityParams {
  readonly motionFollow: boolean
  readonly shakeEnergy: number
  readonly lastPulseAt: number
  readonly time: number
}

/**
 * 지금 흔들림의 세기. 컨트롤러를 따라가는 모드가 아니면 항상 최대(1)이고, 따라가는
 * 중이면 마지막 펄스로부터 지수적으로 잦아든다.
 */
export function shakeIntensity(params: ShakeIntensityParams): number {
  const { motionFollow, shakeEnergy, lastPulseAt, time } = params

  if (!motionFollow) return 1
  if (shakeEnergy <= 0) return 0
  const decayed = shakeEnergy * Math.exp(-(time - lastPulseAt) / SCENE.bowl.followDecayMs)
  return decayed < SCENE.bowl.followMinIntensity ? 0 : decayed
}

export interface ShakeBowlParams extends ShakeIntensityParams {
  readonly shakeStartedAt: number
  readonly lastShakeKick: number
  readonly bowlBody: {
    setNextKinematicTranslation(t: THREE.Vector3Like): void
    setNextKinematicRotation(r: THREE.QuaternionLike): void
  }
  readonly bowlGroup: THREE.Group
  readonly entries: readonly DieEntry[]
  readonly held: PhysicsHeldDice
  readonly random: PhysicsDiceRandom
}

/**
 * 흔드는 한 프레임. 그릇을 움직이고 그 안의 주사위에 임펄스를 준다.
 *
 * @returns 새 `lastShakeKick` — 이번 프레임에 걷어찼으면 지금 시각, 아니면 받은 값 그대로.
 */
export function shakeBowlFrame(params: ShakeBowlParams): number {
  const { time, shakeStartedAt, bowlBody, bowlGroup, entries, held, random } = params
  let { lastShakeKick } = params
  const intensity = shakeIntensity(params) * SCENE.bowl.shakeStrength
  const elapsed = (time - shakeStartedAt) / 1000
  const x = SCENE.bowl.startX + Math.sin(elapsed * 15) * SCENE.bowl.shakeOffsetX * intensity
  const z = SCENE.bowl.startZ + Math.sin(elapsed * 19 + 0.8) * SCENE.bowl.shakeOffsetZ * intensity
  const bowlVelocityX = Math.cos(elapsed * 15) * 15 * SCENE.bowl.shakeOffsetX * intensity
  const bowlVelocityZ = Math.cos(elapsed * 19 + 0.8) * 19 * SCENE.bowl.shakeOffsetZ * intensity
  const yaw = Math.sin(elapsed * 12) * SCENE.bowl.shakeYaw * intensity
  const lift = Math.abs(Math.sin(elapsed * 11)) * 0.025 * intensity
  const rotation = new THREE.Quaternion().setFromAxisAngle(UP, yaw)
  bowlBody.setNextKinematicTranslation({ x, y: SCENE.bowl.hoverY + lift, z })
  bowlBody.setNextKinematicRotation(rotation)
  bowlGroup.position.set(x, SCENE.bowl.hoverY + lift, z)
  bowlGroup.rotation.y = yaw
  if (intensity > 0 && time - lastShakeKick >= SCENE.bowl.shakeIntervalMs) {
    lastShakeKick = time
    const active = entries.filter((entry) => !held[entry.index])
    const kickSlot = Math.floor(random.next() * active.length)
    active.forEach((entry, slot) => {
      const position = entry.body.translation()
      const velocity = entry.body.linvel()
      const centerX = x - position.x
      const centerZ = z - position.z
      const mass = CONFIG.defaults.mass
      const kickRandom = random.next()
      const altitude = position.y - SCENE.bowl.hoverY
      const kickSpeed =
        slot === kickSlot && altitude < SCENE.bowl.shakeKickAltitude
          ? Math.sqrt(
              2 * CONFIG.defaults.gravity * SCENE.bowl.shakeKickHeight * (0.3 + 0.7 * kickRandom),
            )
          : 0
      entry.body.applyImpulse(
        {
          x:
            (bowlVelocityX - velocity.x) * SCENE.bowl.shakeFollowStrength * mass +
            (centerX * SCENE.bowl.shakeCenterStrength -
              centerZ * SCENE.bowl.shakeOrbitStrength +
              (random.next() - 0.5) * SCENE.bowl.shakeRandomImpulse) *
              intensity,
          y: kickSpeed * mass * intensity,
          z:
            (bowlVelocityZ - velocity.z) * SCENE.bowl.shakeFollowStrength * mass +
            (centerZ * SCENE.bowl.shakeCenterStrength +
              centerX * SCENE.bowl.shakeOrbitStrength +
              (random.next() - 0.5) * SCENE.bowl.shakeRandomImpulse) *
              intensity,
        },
        true,
      )
      const torque = SCENE.bowl.shakeTorqueImpulse * intensity
      entry.body.applyTorqueImpulse(
        {
          x: (random.next() - 0.5) * torque,
          y: (random.next() - 0.5) * torque,
          z: (random.next() - 0.5) * torque,
        },
        true,
      )
    })
  }
  return lastShakeKick
}

export interface PourBowlParams {
  readonly time: number
  readonly pourStartedAt: number
  readonly bowlBody: {
    setNextKinematicTranslation(t: THREE.Vector3Like): void
    setNextKinematicRotation(r: THREE.QuaternionLike): void
  }
  readonly bowlGroup: THREE.Group
  readonly diceReleased: boolean
}

/**
 * 기울여 쏟는 한 프레임.
 *
 * @returns `releaseDue`는 이번 프레임에 주사위를 놓아야 하는지, `exitDue`는 기울이기가
 *   끝나 그릇이 화면 밖으로 나갈 차례인지.
 */
export function pourBowlFrame(params: PourBowlParams): {
  readonly releaseDue: boolean
  readonly exitDue: boolean
} {
  const { time, pourStartedAt, bowlBody, bowlGroup, diceReleased } = params
  const elapsed = time - pourStartedAt
  const progress = Math.min(1, elapsed / SCENE.bowl.tiltDurationMs)
  const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2
  const angle = THREE.MathUtils.degToRad(SCENE.bowl.tiltDegrees) * SCENE.bowl.tiltDirection * eased
  const position = tiltedBowlPosition(eased, angle)
  bowlGroup.position.set(position.x, position.y, position.z)
  bowlGroup.rotation.set(0, 0, angle)

  const releaseDue = !diceReleased && progress >= SCENE.bowl.releaseTiltProgress
  // 주사위를 이미 놓았거나 지금 놓을 참이면 **물리 몸체는 건드리지 않는다.** 쏟는
  // 순간 그릇 몸체가 따라 움직이면 막 튀어나온 주사위를 다시 밀어낸다.
  if (!diceReleased && !releaseDue) {
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle)
    bowlBody.setNextKinematicTranslation(position)
    bowlBody.setNextKinematicRotation(rotation)
  }
  return { releaseDue, exitDue: progress >= 1 }
}

/** 그릇이 화면 밖으로 빠지는 한 프레임. 다 나가면 스스로 감춘다. */
export function bowlExitFrame(params: {
  readonly bowlGroup: THREE.Group
  readonly time: number
  readonly bowlExitStartedAt: number
}): void {
  const { bowlGroup, time, bowlExitStartedAt } = params

  if (!bowlGroup.visible) return
  const progress = Math.min(1, (time - bowlExitStartedAt) / SCENE.bowl.exitDurationMs)
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

/**
 * 컨트롤러가 보낸 흔들기 펄스 한 번. 잡히지 않은 주사위를 지정한 방향으로 밀고,
 * 그중 하나만 위로 걷어찬다 — 전부 띄우면 그릇 안이 한꺼번에 솟아 보기 사납다.
 */
export function applyShakePulseImpulses(params: {
  readonly direction: 'left' | 'right'
  readonly clamped: number
  readonly entries: readonly DieEntry[]
  readonly held: PhysicsHeldDice
  readonly random: PhysicsDiceRandom
}): void {
  const { direction, clamped, entries, held, random } = params
  const sign = direction === 'left' ? -1 : 1
  const mass = CONFIG.defaults.mass
  const strengthMultiplier = SCENE.bowl.shakeStrength
  const active = entries.filter((entry) => !held[entry.index])
  const kickSlot = Math.floor(random.next() * active.length)
  active.forEach((entry, slot) => {
    const liftSpeed = Math.sqrt(
      2 * CONFIG.defaults.gravity * SCENE.bowl.shakeKickHeight * (0.25 + 0.75 * clamped),
    )
    entry.body.applyImpulse(
      {
        x: sign * SCENE.bowl.followPulseImpulse * (0.5 + clamped) * mass * strengthMultiplier,
        y: slot === kickSlot ? liftSpeed * mass * strengthMultiplier : 0,
        z: (random.next() - 0.5) * SCENE.bowl.shakeRandomImpulse * strengthMultiplier,
      },
      true,
    )
    entry.body.wakeUp()
  })
}
