import type { NormalizedMotionSample } from './motionTypes'

interface MotionAccelerationLike {
  x: number | null
  y: number | null
  z: number | null
}

export interface DeviceMotionLike {
  acceleration: MotionAccelerationLike | null
  accelerationIncludingGravity: MotionAccelerationLike | null
  timeStamp: number
}

interface Vector3 {
  x: number
  y: number
  z: number
}

const DEFAULT_INTERVAL_MS = 20
const MAX_INTERVAL_MS = 100
const GRAVITY_FILTER_TAU_MS = 800
const ACCELERATION_DEAD_ZONE = 0.35

export class MotionSampleNormalizer {
  private gravity: Vector3 | null = null
  private lastAt: number | null = null

  push(event: DeviceMotionLike, orientationAngle = readOrientationAngle()) {
    const at = event.timeStamp
    const dt =
      this.lastAt === null ? DEFAULT_INTERVAL_MS : Math.min(MAX_INTERVAL_MS, at - this.lastAt)
    this.lastAt = at
    if (!Number.isFinite(at) || !Number.isFinite(dt) || dt <= 0) return null

    const direct = readVector(event.acceleration)
    const linear = direct ?? this.removeGravity(readVector(event.accelerationIncludingGravity), dt)
    if (!linear) return null

    const screen = rotateToScreen(linear, orientationAngle)
    const horizontal = applyDeadZone(screen.x)
    const forward = applyDeadZone(-screen.y)
    const magnitude = Math.hypot(horizontal, forward, applyDeadZone(screen.z))

    return {
      at,
      dt,
      forward,
      horizontal,
      magnitude,
    } satisfies NormalizedMotionSample
  }

  reset() {
    this.gravity = null
    this.lastAt = null
  }

  private removeGravity(value: Vector3 | null, dt: number) {
    if (!value) return null
    if (!this.gravity) {
      this.gravity = { ...value }
      return { x: 0, y: 0, z: 0 }
    }

    const alpha = 1 - Math.exp(-dt / GRAVITY_FILTER_TAU_MS)
    this.gravity.x += alpha * (value.x - this.gravity.x)
    this.gravity.y += alpha * (value.y - this.gravity.y)
    this.gravity.z += alpha * (value.z - this.gravity.z)
    return {
      x: value.x - this.gravity.x,
      y: value.y - this.gravity.y,
      z: value.z - this.gravity.z,
    }
  }
}

function readVector(value: MotionAccelerationLike | null): Vector3 | null {
  if (
    value?.x === null ||
    value?.y === null ||
    value?.z === null ||
    value?.x === undefined ||
    value.y === undefined ||
    value.z === undefined
  ) {
    return null
  }
  if (![value.x, value.y, value.z].every(Number.isFinite)) return null
  return { x: value.x, y: value.y, z: value.z }
}

function rotateToScreen(value: Vector3, angle: number): Vector3 {
  switch (normalizeAngle(angle)) {
    case 90:
      return { x: value.y, y: -value.x, z: value.z }
    case 180:
      return { x: -value.x, y: -value.y, z: value.z }
    case 270:
      return { x: -value.y, y: value.x, z: value.z }
    default:
      return value
  }
}

function normalizeAngle(angle: number) {
  return (((Math.round(angle / 90) * 90) % 360) + 360) % 360
}

/**
 * 화면이 몇 도 돌아가 있는가. `screen.orientation`이 없는 옛 브라우저를 위해
 * `window.orientation`까지 본다 — 둘 다 없으면 세로(0)로 친다.
 */
export function readOrientationAngle() {
  const screenAngle = window.screen.orientation?.angle
  if (typeof screenAngle === 'number') return screenAngle
  const legacyAngle = (window as Window & { orientation?: number }).orientation
  return typeof legacyAngle === 'number' ? legacyAngle : 0
}

function applyDeadZone(value: number) {
  return Math.abs(value) < ACCELERATION_DEAD_ZONE ? 0 : value
}
