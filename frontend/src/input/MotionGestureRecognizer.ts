import { MOTION_GESTURE_CONFIG, type MotionGestureConfig } from './motionConfig'
import type {
  MotionEffectiveThresholds,
  MotionGestureEvent,
  MotionGestureSnapshot,
  MotionGestureState,
  NormalizedMotionSample,
} from './motionTypes'

interface TimedValue {
  at: number
  value: number
}

const QUIET_SAMPLE_RATIO = 0.6
const MAX_NOISE_RMS = 2.5
const MAX_NOISE_JERK = 120

export class MotionGestureRecognizer {
  private calibrated = false
  private calibrationForward: TimedValue[] = []
  private calibrationMagnitude: number[] = []
  private cooldownUntil = 0
  private effectiveThresholds: MotionEffectiveThresholds
  private forwardImpulse: TimedValue[] = []
  private gestureState: MotionGestureState = 'idle'
  private horizontalWindow: TimedValue[] = []
  private lastForward = 0
  private lastPeakAt = 0
  private lastPeakSign = 0
  private lastPulseDirection: 'left' | 'right' | null = null
  private lastShakeAt = 0
  private peakReady = true
  private reversalCount = 0
  private shakeStartedAt = 0
  private warmupStartedAt: number | null = null

  constructor(private readonly config: MotionGestureConfig = MOTION_GESTURE_CONFIG) {
    this.effectiveThresholds = baseThresholds(config)
  }

  push(sample: NormalizedMotionSample): MotionGestureEvent[] {
    const events: MotionGestureEvent[] = []
    if (this.warmupStartedAt === null) {
      this.warmupStartedAt = sample.at
      this.gestureState = 'calibrating'
    }
    if (sample.at - this.warmupStartedAt < this.config.sensorWarmupMs) {
      this.collectCalibrationSample(sample)
      this.lastForward = sample.forward
      return events
    }
    if (!this.calibrated) this.completeCalibration()

    if (this.gestureState === 'cooldown' && sample.at >= this.cooldownUntil) {
      this.resetTracking('idle')
    }
    if (this.gestureState === 'cooldown' || this.gestureState === 'thrown') return events

    this.handleTimeouts(sample.at, events)
    this.trackHorizontalEnergy(sample)
    this.detectShakePeak(sample, events)
    this.detectThrow(sample, events)
    this.lastForward = sample.forward
    return events
  }

  getSnapshot(): MotionGestureSnapshot {
    return {
      calibrated: this.calibrated,
      canConfirmThrow: this.gestureState === 'shaking' || this.gestureState === 'armed',
      effectiveThresholds: this.effectiveThresholds,
      gestureState: this.gestureState,
      lastPulseDirection: this.lastPulseDirection,
      noiseRms: this.calibratedNoiseRms(),
      reversalCount: this.reversalCount,
    }
  }

  reset(reason = 'reset') {
    const wasActive = this.gestureState !== 'idle'
    this.resetTracking('idle')
    this.warmupStartedAt = null
    this.calibrated = false
    this.calibrationForward = []
    this.calibrationMagnitude = []
    this.effectiveThresholds = baseThresholds(this.config)
    return wasActive
      ? ({ type: 'gestureCancelled', at: performance.now(), reason } satisfies MotionGestureEvent)
      : null
  }

  private handleTimeouts(at: number, events: MotionGestureEvent[]) {
    if (
      this.gestureState === 'shakeCandidate' &&
      at - this.lastPeakAt > this.config.shakeMaxPeakGapMs
    ) {
      this.resetTracking('idle')
      return
    }

    if (
      this.gestureState === 'shaking' &&
      (at - this.lastShakeAt >= this.config.shakeLostMs ||
        at - this.shakeStartedAt >= this.config.throwTimeoutMs)
    ) {
      this.gestureState = 'armed'
      this.lastPulseDirection = null
      events.push({ type: 'shakeArmed', at })
    }
  }

  private trackHorizontalEnergy(sample: NormalizedMotionSample) {
    this.horizontalWindow.push({ at: sample.at, value: sample.horizontal })
    const cutoff = sample.at - this.config.shakeWindowMs
    while (this.horizontalWindow[0] && this.horizontalWindow[0].at < cutoff) {
      this.horizontalWindow.shift()
    }
  }

  private detectShakePeak(sample: NormalizedMotionSample, events: MotionGestureEvent[]) {
    const absolute = Math.abs(sample.horizontal)
    if (absolute <= this.effectiveThresholds.shakePeakRelease) {
      this.peakReady = true
      return
    }
    if (!this.peakReady || absolute < this.effectiveThresholds.shakePeak) return

    const sign = Math.sign(sample.horizontal)
    const gap = this.lastPeakAt === 0 ? 0 : sample.at - this.lastPeakAt
    if (this.lastPeakAt > 0 && gap < this.config.shakeMinPeakGapMs) return
    if (this.lastPeakAt > 0 && gap > this.config.shakeMaxPeakGapMs) {
      this.resetTracking('idle')
    }

    this.peakReady = false
    if (this.lastPeakSign !== 0 && sign !== this.lastPeakSign) this.reversalCount += 1
    this.lastPeakAt = sample.at
    this.lastPeakSign = sign
    this.lastShakeAt = sample.at
    this.lastPulseDirection = sign < 0 ? 'left' : 'right'
    if (this.gestureState === 'idle') this.gestureState = 'shakeCandidate'

    events.push({
      type: 'shakePulse',
      at: sample.at,
      direction: this.lastPulseDirection,
      strength: Math.min(1, absolute / (this.effectiveThresholds.shakePeak * 2)),
    })

    if (
      this.gestureState === 'shakeCandidate' &&
      this.reversalCount >= this.config.shakeRequiredReversals &&
      this.horizontalRms() >= this.effectiveThresholds.shakeMinRms
    ) {
      this.gestureState = 'shaking'
      this.shakeStartedAt = sample.at
      events.push({ type: 'shakeStarted', at: sample.at })
    }
  }

  private detectThrow(sample: NormalizedMotionSample, events: MotionGestureEvent[]) {
    if (this.gestureState !== 'shaking' && this.gestureState !== 'armed') return
    if (sample.at - this.shakeStartedAt < this.config.throwArmDelayMs) return

    this.forwardImpulse.push({
      at: sample.at,
      value: Math.max(0, sample.forward) * (sample.dt / 1_000),
    })
    const cutoff = sample.at - this.config.throwImpulseWindowMs
    while (this.forwardImpulse[0] && this.forwardImpulse[0].at < cutoff) {
      this.forwardImpulse.shift()
    }

    const impulse = this.forwardImpulse.reduce((sum, entry) => sum + entry.value, 0)
    const jerk = Math.abs(sample.forward - this.lastForward) / (sample.dt / 1_000)
    const directionRatio = sample.magnitude > 0 ? Math.max(0, sample.forward) / sample.magnitude : 0
    if (
      sample.forward < this.effectiveThresholds.throwPeak ||
      impulse < this.effectiveThresholds.throwImpulse ||
      jerk < this.effectiveThresholds.throwJerk ||
      directionRatio < this.config.throwDirectionRatio
    ) {
      return
    }

    const confidence = Math.min(
      1,
      (sample.forward / this.effectiveThresholds.throwPeak +
        impulse / this.effectiveThresholds.throwImpulse +
        jerk / this.effectiveThresholds.throwJerk +
        directionRatio / this.config.throwDirectionRatio) /
        6,
    )
    this.gestureState = 'thrown'
    this.lastPulseDirection = null
    events.push({ type: 'throwDetected', at: sample.at, confidence })
    this.gestureState = 'cooldown'
    this.cooldownUntil = sample.at + this.config.cooldownMs
  }

  private horizontalRms() {
    if (this.horizontalWindow.length === 0) return 0
    const squares = this.horizontalWindow.reduce((sum, entry) => sum + entry.value ** 2, 0)
    return Math.sqrt(squares / this.horizontalWindow.length)
  }

  private collectCalibrationSample(sample: NormalizedMotionSample) {
    this.calibrationMagnitude.push(sample.magnitude)
    this.calibrationForward.push({ at: sample.at, value: sample.forward })
  }

  private completeCalibration() {
    const noiseRms = this.calibratedNoiseRms()
    const noiseJerk = Math.min(MAX_NOISE_JERK, quietRms(forwardJerks(this.calibrationForward)))
    const impulseNoise = noiseRms * (this.config.throwImpulseWindowMs / 1_000) * 3
    this.effectiveThresholds = {
      shakeMinRms: Math.max(this.config.shakeMinRms, noiseRms * 2.5),
      shakePeak: Math.max(this.config.shakePeakThreshold, noiseRms * 4),
      shakePeakRelease: Math.max(this.config.shakePeakReleaseThreshold, noiseRms * 1.5),
      throwImpulse: Math.max(this.config.throwImpulseThreshold, impulseNoise),
      throwJerk: Math.max(this.config.throwJerkThreshold, noiseJerk * 3),
      throwPeak: Math.max(this.config.throwPeakThreshold, noiseRms * 7),
    }
    this.calibrated = true
    this.gestureState = 'idle'
  }

  private calibratedNoiseRms() {
    return Math.min(MAX_NOISE_RMS, quietRms(this.calibrationMagnitude))
  }

  private resetTracking(state: MotionGestureState) {
    this.forwardImpulse = []
    this.gestureState = state
    this.horizontalWindow = []
    this.lastForward = 0
    this.lastPeakAt = 0
    this.lastPeakSign = 0
    this.lastPulseDirection = null
    this.lastShakeAt = 0
    this.peakReady = true
    this.reversalCount = 0
    this.shakeStartedAt = 0
  }
}

function baseThresholds(config: MotionGestureConfig): MotionEffectiveThresholds {
  return {
    shakeMinRms: config.shakeMinRms,
    shakePeak: config.shakePeakThreshold,
    shakePeakRelease: config.shakePeakReleaseThreshold,
    throwImpulse: config.throwImpulseThreshold,
    throwJerk: config.throwJerkThreshold,
    throwPeak: config.throwPeakThreshold,
  }
}

function quietRms(values: number[]) {
  if (values.length === 0) return 0
  const sorted = values.map(Math.abs).sort((left, right) => left - right)
  const quietCount = Math.max(1, Math.floor(sorted.length * QUIET_SAMPLE_RATIO))
  const quiet = sorted.slice(0, quietCount)
  return Math.sqrt(quiet.reduce((sum, value) => sum + value ** 2, 0) / quiet.length)
}

function forwardJerks(values: TimedValue[]) {
  const jerks: number[] = []
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1]
    const current = values[index]
    if (!previous || !current) continue
    const dt = (current.at - previous.at) / 1_000
    if (dt > 0) jerks.push(Math.abs(current.value - previous.value) / dt)
  }
  return jerks
}
