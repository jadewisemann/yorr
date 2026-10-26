import { MotionCalibration } from './motionCalibration'
import { MOTION_GESTURE_CONFIG, type MotionGestureConfig } from './motionConfig'
import type {
  MotionGestureEvent,
  MotionGestureSnapshot,
  MotionGestureState,
  NormalizedMotionSample,
} from './motionTypes'
import { ShakeDetector } from './shakeDetector'
import { ThrowDetector } from './throwDetector'

/**
 * 손동작 인식기 — 센서 샘플을 **흔들기·던지기 이벤트**로 바꾼다.
 *
 * 세 관심사를 세 파일로 갈랐다:
 * - `motionCalibration.ts` — 워밍업 구간의 바닥 소음과 임계값 상향
 * - `shakeDetector.ts` — 좌우 피크·반전 수·좌우 RMS
 * - `throwDetector.ts` — 앞뒤 스냅·임펄스·방향 비율
 *
 * 이 클래스에 남는 것은 **상태 기계의 순서**다: 교정 → 흔들기 → 무장(armed) →
 * 던지기 → 쿨다운. 순서가 계약이라(같은 샘플이 두 판정에 동시에 쓰인다) 한 곳에서
 * 읽혀야 한다.
 */
export class MotionGestureRecognizer {
  private calibrated = false
  private readonly calibration: MotionCalibration
  private readonly shake: ShakeDetector
  private readonly throw: ThrowDetector
  private cooldownUntil = 0
  private gestureState: MotionGestureState = 'idle'
  private lastForward = 0
  private lastPulseDirection: 'left' | 'right' | null = null
  private warmupStartedAt: number | null = null

  constructor(private readonly config: MotionGestureConfig = MOTION_GESTURE_CONFIG) {
    this.calibration = new MotionCalibration(config)
    this.shake = new ShakeDetector(config)
    this.throw = new ThrowDetector(config)
  }

  push(sample: NormalizedMotionSample): MotionGestureEvent[] {
    const events: MotionGestureEvent[] = []
    if (this.warmupStartedAt === null) {
      this.warmupStartedAt = sample.at
      this.gestureState = 'calibrating'
    }
    if (sample.at - this.warmupStartedAt < this.config.sensorWarmupMs) {
      this.calibration.collect(sample)
      this.lastForward = sample.forward
      return events
    }
    if (!this.calibrated) this.completeCalibration()

    if (this.gestureState === 'cooldown' && sample.at >= this.cooldownUntil) {
      this.resetTracking('idle')
    }
    if (this.gestureState === 'cooldown' || this.gestureState === 'thrown') return events

    this.handleTimeouts(sample.at, events)
    this.shake.track(sample.at, sample.horizontal)
    this.detectShake(sample, events)
    this.detectThrow(sample, events)
    this.lastForward = sample.forward
    return events
  }

  getSnapshot(): MotionGestureSnapshot {
    return {
      calibrated: this.calibrated,
      canConfirmThrow: this.gestureState === 'shaking' || this.gestureState === 'armed',
      effectiveThresholds: this.calibration.effectiveThresholds,
      gestureState: this.gestureState,
      lastPulseDirection: this.lastPulseDirection,
      noiseRms: this.calibration.noiseRms,
      reversalCount: this.shake.reversalCount,
    }
  }

  reset(reason = 'reset') {
    const wasActive = this.gestureState !== 'idle'
    this.resetTracking('idle')
    this.warmupStartedAt = null
    this.calibrated = false
    this.calibration.reset()
    return wasActive
      ? ({ type: 'gestureCancelled', at: performance.now(), reason } satisfies MotionGestureEvent)
      : null
  }

  /** 무장 해제·소실 판정 — 흔들기가 멈췄거나 던지기 제한 시간을 넘겼다. */
  private handleTimeouts(at: number, events: MotionGestureEvent[]) {
    if (
      this.gestureState === 'shakeCandidate' &&
      at - this.shake.lastPeakAt > this.config.shakeMaxPeakGapMs
    ) {
      this.resetTracking('idle')
      return
    }

    if (
      this.gestureState === 'shaking' &&
      (at - this.shake.lastActiveAt >= this.config.shakeLostMs ||
        at - this.shake.startedAtMs >= this.config.throwTimeoutMs)
    ) {
      this.gestureState = 'armed'
      this.lastPulseDirection = null
      events.push({ type: 'shakeArmed', at })
    }
  }

  private detectShake(sample: NormalizedMotionSample, events: MotionGestureEvent[]) {
    const result = this.shake.observe(
      sample,
      this.gestureState,
      this.calibration.effectiveThresholds,
    )
    this.gestureState = result.state
    for (const event of result.events) {
      if (event.type === 'shakePulse') {
        this.lastPulseDirection = event.direction ?? null
        events.push({
          type: 'shakePulse',
          at: event.at,
          direction: event.direction ?? 'right',
          strength: event.strength ?? 0,
        })
        continue
      }
      events.push({ type: 'shakeStarted', at: event.at })
    }
  }

  private detectThrow(sample: NormalizedMotionSample, events: MotionGestureEvent[]) {
    if (this.gestureState !== 'shaking' && this.gestureState !== 'armed') return
    if (sample.at - this.shake.startedAtMs < this.config.throwArmDelayMs) return

    const reading = this.throw.observe(
      sample,
      this.lastForward,
      this.calibration.effectiveThresholds,
    )
    if (reading.confidence === null) return
    this.lastPulseDirection = null
    events.push({ type: 'throwDetected', at: sample.at, confidence: reading.confidence })
    this.gestureState = 'cooldown'
    this.cooldownUntil = sample.at + this.config.cooldownMs
  }

  private completeCalibration() {
    this.calibration.complete()
    this.calibrated = true
    this.gestureState = 'idle'
  }

  private resetTracking(state: MotionGestureState) {
    this.throw.reset()
    this.shake.reset()
    this.gestureState = state
    this.lastForward = 0
    this.lastPulseDirection = null
  }
}
