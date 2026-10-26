import { MOTION_GESTURE_CONFIG, type MotionGestureConfig } from './motionConfig'
import type { MotionEffectiveThresholds, NormalizedMotionSample } from './motionTypes'

/**
 * 손동작 인식기의 **던지기(throw) 판정** — 앞뒤 임펄스 창, 스냅 크기, 방향 비율.
 *
 * 흔들기(`shakeDetector.ts`)와 갈라 둔 이유는 축이 다르기 때문이다. 흔들기는 좌우
 * 반전을, 던지기는 앞뒤 스파이크를 본다. 두 판정이 같은 클래스에 있으면 "이 필드가
 * 어느 동작의 것인가"를 계속 확인해야 한다.
 */

interface TimedValue {
  at: number
  value: number
}

export interface ThrowReading {
  /** 던지기로 확정됐는가. 확정이면 신뢰도(0~1)가 함께 온다. */
  readonly confidence: number | null
  readonly nextLastForward: number
}

export class ThrowDetector {
  private impulses: TimedValue[] = []

  constructor(private readonly config: MotionGestureConfig = MOTION_GESTURE_CONFIG) {}

  /**
   * 한 샘플을 본다. **흔들기 상태에서만** 의미가 있다(호출자가 걸러 준다).
   *
   * 네 조건(스냅·임펄스·저크·방향 비율)을 모두 넘어야 던지기다 — 하나라도 빠지면
   * 손을 흔든 것과 구분되지 않는다.
   */
  observe(
    sample: NormalizedMotionSample,
    lastForward: number,
    thresholds: MotionEffectiveThresholds,
  ): ThrowReading {
    const snap = Math.abs(sample.forward)
    this.impulses.push({ at: sample.at, value: snap * (sample.dt / 1_000) })
    const cutoff = sample.at - this.config.throwImpulseWindowMs
    while (this.impulses[0] && this.impulses[0].at < cutoff) this.impulses.shift()

    const impulse = this.impulses.reduce((sum, entry) => sum + entry.value, 0)
    const jerk = Math.abs(sample.forward - lastForward) / (sample.dt / 1_000)
    const directionRatio = sample.magnitude > 0 ? snap / sample.magnitude : 0
    if (
      snap < thresholds.throwPeak ||
      impulse < thresholds.throwImpulse ||
      jerk < thresholds.throwJerk ||
      directionRatio < this.config.throwDirectionRatio
    ) {
      return { confidence: null, nextLastForward: sample.forward }
    }

    const confidence = Math.min(
      1,
      (snap / thresholds.throwPeak +
        impulse / thresholds.throwImpulse +
        jerk / thresholds.throwJerk +
        directionRatio / this.config.throwDirectionRatio) /
        6,
    )
    return { confidence, nextLastForward: sample.forward }
  }

  reset(): void {
    this.impulses = []
  }
}
