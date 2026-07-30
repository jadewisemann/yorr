export interface MotionGestureConfig {
  cooldownMs: number
  sensorWarmupMs: number
  shakeLostMs: number
  shakeMaxPeakGapMs: number
  shakeMinPeakGapMs: number
  shakeMinRms: number
  shakePeakReleaseThreshold: number
  shakePeakThreshold: number
  shakeRequiredReversals: number
  shakeWindowMs: number
  throwArmDelayMs: number
  throwDirectionRatio: number
  throwImpulseThreshold: number
  throwImpulseWindowMs: number
  throwJerkThreshold: number
  throwPeakThreshold: number
  throwTimeoutMs: number
}

export const MOTION_GESTURE_CONFIG: MotionGestureConfig = Object.freeze({
  cooldownMs: 1_200,
  sensorWarmupMs: 300,
  shakeLostMs: 900,
  shakeMaxPeakGapMs: 450,
  shakeMinPeakGapMs: 120,
  shakeMinRms: 3.5,
  shakePeakReleaseThreshold: 2.5,
  shakePeakThreshold: 6,
  shakeRequiredReversals: 3,
  shakeWindowMs: 1_200,
  throwArmDelayMs: 180,
  throwDirectionRatio: 0.6,
  throwImpulseThreshold: 0.9,
  throwImpulseWindowMs: 180,
  throwJerkThreshold: 70,
  throwPeakThreshold: 12,
  throwTimeoutMs: 4_000,
})

export const MOTION_SAMPLE_SILENT_MS = 700
