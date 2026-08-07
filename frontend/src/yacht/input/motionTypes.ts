export type MotionAvailability =
  | 'unknown'
  | 'permissionRequired'
  | 'requesting'
  | 'listening'
  | 'insecure'
  | 'unsupported'
  | 'denied'
  | 'silent'
  | 'paused'
  | 'error'

/** 센서 안내 패널이 다룰 수 있는 상태들. MotionPermissionPanel의 prop과 같은 집합이다. */
export type MotionOfferableAvailability =
  | 'permissionRequired'
  | 'requesting'
  | 'denied'
  | 'error'
  | 'insecure'

/**
 * 센서를 켜자고 권할 수 있는 상태인지. 켤 것이 아무것도 없는 기기(데스크톱 · unsupported)와
 * 이미 듣고 있는 상태를 걸러낸다.
 *
 * 트레이의 흔들기 칩과 연습 모드의 흔들기 단계가 같은 판단을 써야 하므로 타입 옆에 둔다 —
 * 화면마다 조건을 다시 적으면 한쪽만 고쳐질 때 칩은 없는데 안내는 흔들라고 한다.
 *
 * 반환형을 타입 가드로 못박아 둔다. 그냥 boolean으로 두면 이 판단을 통과한 값을
 * MotionPermissionPanel에 그대로 넘길 수 없다.
 */
export function canOfferMotion(
  availability: MotionAvailability,
): availability is MotionOfferableAvailability {
  return (
    availability === 'permissionRequired' ||
    availability === 'requesting' ||
    availability === 'denied' ||
    availability === 'error' ||
    availability === 'insecure'
  )
}

export type MotionGestureState =
  | 'calibrating'
  | 'idle'
  | 'shakeCandidate'
  | 'shaking'
  | 'armed'
  | 'thrown'
  | 'cooldown'

export type MotionGestureEvent =
  | { type: 'shakeStarted'; at: number }
  | {
      type: 'shakePulse'
      at: number
      direction: 'left' | 'right'
      strength: number
    }
  | { type: 'shakeArmed'; at: number }
  | { type: 'throwDetected'; at: number; confidence: number }
  | { type: 'gestureCancelled'; at: number; reason: string }

export interface NormalizedMotionSample {
  at: number
  dt: number
  forward: number
  horizontal: number
  magnitude: number
}

export interface MotionGestureSnapshot {
  calibrated: boolean
  canConfirmThrow: boolean
  effectiveThresholds: MotionEffectiveThresholds
  gestureState: MotionGestureState
  lastPulseDirection: 'left' | 'right' | null
  noiseRms: number
  reversalCount: number
}

export interface MotionEffectiveThresholds {
  shakeMinRms: number
  shakePeakRelease: number
  shakePeak: number
  throwImpulse: number
  throwJerk: number
  throwPeak: number
}
