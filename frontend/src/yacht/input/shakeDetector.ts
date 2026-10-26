import { MOTION_GESTURE_CONFIG, type MotionGestureConfig } from './motionConfig'
import type { MotionEffectiveThresholds, MotionGestureState } from './motionTypes'

/**
 * 손동작 인식기의 **흔들기(shaking) 판정** — 좌우 에너지 창, 피크, 반전 수.
 *
 * 인식기(`MotionGestureRecognizer.ts`)에서 갈라 둔 이유: 흔들기는 좌우 축만 보고,
 * 던지기는 앞뒤 축만 본다. 두 축의 상태 기계를 한 클래스에 두면 어느 필드가 어느
 * 동작에 속하는지 읽기 어렵다.
 */

export interface ShakeEvent {
  readonly type: 'shakePulse' | 'shakeStarted'
  readonly at: number
  readonly direction?: 'left' | 'right'
  readonly strength?: number
}

interface TimedValue {
  at: number
  value: number
}

export class ShakeDetector {
  private window: TimedValue[] = []
  private lastPeakAtMs = 0
  private lastPeakSign = 0
  private lastShakeAt = 0
  private peakReady = true
  private reversals = 0
  private startedAt = 0

  constructor(private readonly config: MotionGestureConfig = MOTION_GESTURE_CONFIG) {}

  get lastPeakAt(): number {
    return this.lastPeakAtMs
  }

  get lastActiveAt(): number {
    return this.lastShakeAt
  }

  get reversalCount(): number {
    return this.reversals
  }

  get startedAtMs(): number {
    return this.startedAt
  }

  /** 좌우 에너지 창을 밀어 둔다 — 창 밖 샘플은 버린다. */
  track(at: number, horizontal: number): void {
    this.window.push({ at, value: horizontal })
    const cutoff = at - this.config.shakeWindowMs
    while (this.window[0] && this.window[0].at < cutoff) this.window.shift()
  }

  /**
   * 피크 하나를 본다. 흔들기가 성립하면 `shakeStarted`까지 돌려준다.
   *
   * @returns 새 상태와 이번 샘플이 만든 이벤트. 호출자는 상태를 그대로 받아 쓴다.
   */
  observe(
    sample: { readonly at: number; readonly horizontal: number },
    state: MotionGestureState,
    thresholds: MotionEffectiveThresholds,
  ): { events: ShakeEvent[]; state: MotionGestureState } {
    const events: ShakeEvent[] = []
    const absolute = Math.abs(sample.horizontal)
    if (absolute <= thresholds.shakePeakRelease) {
      this.peakReady = true
      return { events, state }
    }
    if (!this.peakReady || absolute < thresholds.shakePeak) return { events, state }

    const sign = Math.sign(sample.horizontal)
    const gap = this.lastPeakAtMs === 0 ? 0 : sample.at - this.lastPeakAtMs
    if (this.lastPeakAtMs > 0 && gap < this.config.shakeMinPeakGapMs) return { events, state }
    let nextState = state
    if (this.lastPeakAtMs > 0 && gap > this.config.shakeMaxPeakGapMs) {
      this.reset()
      nextState = 'idle'
    }

    this.peakReady = false
    if (this.lastPeakSign !== 0 && sign !== this.lastPeakSign) this.reversals += 1
    this.lastPeakAtMs = sample.at
    this.lastPeakSign = sign
    this.lastShakeAt = sample.at
    if (nextState === 'idle') nextState = 'shakeCandidate'

    events.push({
      type: 'shakePulse',
      at: sample.at,
      direction: sign < 0 ? 'left' : 'right',
      strength: Math.min(1, absolute / (thresholds.shakePeak * 2)),
    })

    if (
      nextState === 'shakeCandidate' &&
      this.reversals >= this.config.shakeRequiredReversals &&
      this.rms() >= thresholds.shakeMinRms
    ) {
      nextState = 'shaking'
      this.startedAt = sample.at
      events.push({ type: 'shakeStarted', at: sample.at })
    }
    return { events, state: nextState }
  }

  /** 창 안 좌우 성분의 RMS. */
  rms(): number {
    if (this.window.length === 0) return 0
    const squares = this.window.reduce((sum, entry) => sum + entry.value ** 2, 0)
    return Math.sqrt(squares / this.window.length)
  }

  reset(): void {
    this.window = []
    this.lastPeakAtMs = 0
    this.lastPeakSign = 0
    this.lastShakeAt = 0
    this.peakReady = true
    this.reversals = 0
    this.startedAt = 0
  }
}
