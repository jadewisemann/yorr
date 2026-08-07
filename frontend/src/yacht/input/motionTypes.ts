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

export type MotionOfferableAvailability =
  | 'permissionRequired'
  | 'requesting'
  | 'denied'
  | 'error'
  | 'insecure'

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
