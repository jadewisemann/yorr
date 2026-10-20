import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { PHYSICS_DICE_CONFIG } from './config'
import { keepSlotPosition, keepSlotScale, simulationDieScale } from './layout'
import { quaternionForTopValue } from './model'
import type { PhysicsDiceRandom } from './random'
import type { DieEntry } from './runtimeTypes'
import type { PhysicsDiceSet, PhysicsHeldDice } from './types'

/**
 * 사발의 흔들기·쏟기와 주사위 임펄스. `PhysicsDiceWorld`에서 분리한 이유는 이 조각들이
 * 장면·프레임 루프를 모르고, 넘겨받은 값만으로 결정되기 때문이다. 상태 전이는 World가 진다.
 */

const CONFIG = PHYSICS_DICE_CONFIG
const SCENE = CONFIG.scene
const UP = new THREE.Vector3(0, 1, 0)

export interface BowlShakePose {
  rotation: THREE.Quaternion
  velocityX: number
  velocityZ: number
  x: number
  y: number
  yaw: number
  z: number
}

/** 흔들기 단계의 사발 자세. 시간과 세기만으로 정해진다. */
export function bowlShakePose(elapsedSeconds: number, intensity: number): BowlShakePose {
  const x = SCENE.bowl.startX + Math.sin(elapsedSeconds * 15) * SCENE.bowl.shakeOffsetX * intensity
  const z =
    SCENE.bowl.startZ + Math.sin(elapsedSeconds * 19 + 0.8) * SCENE.bowl.shakeOffsetZ * intensity
  const velocityX = Math.cos(elapsedSeconds * 15) * 15 * SCENE.bowl.shakeOffsetX * intensity
  const velocityZ = Math.cos(elapsedSeconds * 19 + 0.8) * 19 * SCENE.bowl.shakeOffsetZ * intensity
  const yaw = Math.sin(elapsedSeconds * 12) * SCENE.bowl.shakeYaw * intensity
  const lift = Math.abs(Math.sin(elapsedSeconds * 11)) * 0.025 * intensity
  return {
    rotation: new THREE.Quaternion().setFromAxisAngle(UP, yaw),
    velocityX,
    velocityZ,
    x,
    y: SCENE.bowl.hoverY + lift,
    yaw,
    z,
  }
}

interface ShakeKickOptions {
  entries: DieEntry[]
  held: PhysicsHeldDice
  pose: BowlShakePose
  intensity: number
  random: PhysicsDiceRandom
}

/** 사발 리듬에 맞춘 한 번의 걷어차기 — 사발 속도에 주사위를 붙잡아 두다가 하나를 띄운다. */
export function applyShakeKick({ entries, held, pose, intensity, random }: ShakeKickOptions) {
  const active = entries.filter((entry) => !held[entry.index])
  const kickSlot = Math.floor(random.next() * active.length)
  active.forEach((entry, slot) => {
    const position = entry.body.translation()
    const velocity = entry.body.linvel()
    const centerX = pose.x - position.x
    const centerZ = pose.z - position.z
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
          (pose.velocityX - velocity.x) * SCENE.bowl.shakeFollowStrength * mass +
          (centerX * SCENE.bowl.shakeCenterStrength -
            centerZ * SCENE.bowl.shakeOrbitStrength +
            (random.next() - 0.5) * SCENE.bowl.shakeRandomImpulse) *
            intensity,
        y: kickSpeed * mass * intensity,
        z:
          (pose.velocityZ - velocity.z) * SCENE.bowl.shakeFollowStrength * mass +
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

interface ShakePulseOptions {
  entries: DieEntry[]
  held: PhysicsHeldDice
  random: PhysicsDiceRandom
  sign: -1 | 1
  strength: number
}

/** 기기 기울임(모션 펄스) 한 번 — 방향과 세기만큼 사발 속 주사위를 민다. */
export function applyShakePulse({ entries, held, random, sign, strength }: ShakePulseOptions) {
  const mass = CONFIG.defaults.mass
  const strengthMultiplier = SCENE.bowl.shakeStrength
  const active = entries.filter((entry) => !held[entry.index])
  const kickSlot = Math.floor(random.next() * active.length)
  active.forEach((entry, slot) => {
    const liftSpeed = Math.sqrt(
      2 * CONFIG.defaults.gravity * SCENE.bowl.shakeKickHeight * (0.25 + 0.75 * strength),
    )
    entry.body.applyImpulse(
      {
        x: sign * SCENE.bowl.followPulseImpulse * (0.5 + strength) * mass * strengthMultiplier,
        y: slot === kickSlot ? liftSpeed * mass * strengthMultiplier : 0,
        z: (random.next() - 0.5) * SCENE.bowl.shakeRandomImpulse * strengthMultiplier,
      },
      true,
    )
    entry.body.wakeUp()
  })
}

interface ReleaseOptions {
  entries: DieEntry[]
  held: PhysicsHeldDice
  random: PhysicsDiceRandom
}

/** 쏟기 — 사발을 기울인 뒤 주사위를 트레이 쪽으로 밀어낸다. */
export function releaseDiceImpulses({ entries, held, random }: ReleaseOptions) {
  const active = entries.filter((entry) => !held[entry.index])
  active.forEach((entry, index) => {
    entry.enteredTray = false
    const fan = index - (active.length - 1) / 2
    const force = CONFIG.defaults.throwForce
    const velocity = entry.body.linvel()
    const targetX =
      (SCENE.bowl.spillMinimumSpeed + random.next() * SCENE.bowl.spillRandomSpeed) *
      force *
      SCENE.bowl.spillForceMultiplier *
      SCENE.bowl.spillDirectionX
    entry.body.setLinvel(
      {
        x: targetX,
        y: Math.max(velocity.y * 0.2, SCENE.bowl.spillLiftSpeed * force),
        z: fan * SCENE.bowl.spillFanSpeed * force + (random.next() - 0.5) * SCENE.bowl.spillRandomZ,
      },
      true,
    )
    const angular = entry.body.angvel()
    entry.body.setAngvel(
      {
        x: angular.x * 0.4,
        y: angular.y * 0.4,
        z: angular.z * 0.4,
      },
      true,
    )
  })
}

interface SpawnOptions {
  committedDice: PhysicsDiceSet
  entries: DieEntry[]
  held: PhysicsHeldDice
  heldOrder: readonly number[]
  random: PhysicsDiceRandom
}

/**
 * 굴림 시작 배치. 킵한 주사위는 슬롯에 고정하고, 나머지는 사발 안 원형으로 뿌린 뒤
 * 초기 속도·각속도를 준다. 같은 seed면 같은 배치가 나온다.
 */
export function spawnDiceForRoll({
  committedDice,
  entries,
  held,
  heldOrder,
  random,
}: SpawnOptions) {
  const heldSlots = new Map(heldOrder.map((index, slot) => [index, slot]))
  entries.forEach((entry) => {
    const isHeld = held[entry.index]
    const halfSize = CONFIG.defaults.diceSize * SCENE.colliderHalfRatio * SCENE.bowlDiceScale
    entry.collider.setShape(new RAPIER.Cuboid(halfSize, halfSize, halfSize))
    if (isHeld) {
      const position = keepSlotPosition(heldSlots.get(entry.index) ?? 0)
      entry.mesh.visible = true
      entry.mesh.scale.setScalar(keepSlotScale())
      entry.body.setBodyType(RAPIER.RigidBodyType.Fixed, true)
      entry.body.setTranslation(position, true)
      entry.body.setRotation(quaternionForTopValue(committedDice[entry.index]), true)
      entry.outline.position.set(position.x, 0.04, position.z)
      entry.outline.scale.set(keepSlotScale(), keepSlotScale(), 1)
      entry.outline.visible = true
      entry.outline.material.opacity = 0.92
      return
    }

    const angle = (entry.index / entries.length) * Math.PI * 2 - Math.PI / 2
    const radius = SCENE.bowl.spawnRadius + (random.next() - 0.5) * SCENE.bowl.spawnJitter
    entry.outline.visible = false
    entry.mesh.visible = true
    entry.mesh.scale.setScalar(simulationDieScale())
    entry.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
    entry.body.setLinearDamping(CONFIG.defaults.linearDamping)
    entry.body.setAngularDamping(CONFIG.defaults.angularDamping)
    entry.body.setTranslation(
      {
        x: SCENE.bowl.startX + Math.cos(angle) * radius,
        y: SCENE.bowl.hoverY + SCENE.bowl.spawnBaseY + random.next() * SCENE.bowl.spawnRangeY,
        z: SCENE.bowl.startZ + Math.sin(angle) * radius,
      },
      true,
    )
    entry.body.setRotation(randomQuaternion(random), true)
    entry.body.setLinvel(
      {
        x: (random.next() - 0.5) * CONFIG.defaults.spawnLinearSpeed,
        y: random.next() * CONFIG.defaults.spawnLiftSpeed,
        z: (random.next() - 0.5) * CONFIG.defaults.spawnLinearSpeed,
      },
      true,
    )
    entry.body.setAngvel(
      {
        x: (random.next() - 0.5) * CONFIG.defaults.spawnAngularSpeed,
        y: (random.next() - 0.5) * CONFIG.defaults.spawnAngularSpeed,
        z: (random.next() - 0.5) * CONFIG.defaults.spawnAngularSpeed,
      },
      true,
    )
    entry.body.wakeUp()
  })
}

/** 쏟기 기울기 진행도 — 앞 절반 가속, 뒤 절반 감속. */
export function easedTilt(progress: number): number {
  return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2
}

/** 균등 분포 구면 위의 회전 — 초기 자세가 한쪽으로 몰리지 않게. */
export function randomQuaternion(random: PhysicsDiceRandom): THREE.Quaternion {
  const theta1 = 2 * Math.PI * random.next()
  const theta2 = 2 * Math.PI * random.next()
  const x0 = random.next()
  const r1 = Math.sqrt(1 - x0)
  const r2 = Math.sqrt(x0)
  return new THREE.Quaternion(
    r1 * Math.sin(theta1),
    r1 * Math.cos(theta1),
    r2 * Math.sin(theta2),
    r2 * Math.cos(theta2),
  )
}
