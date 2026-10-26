import { MOTION_GESTURE_CONFIG, type MotionGestureConfig } from './motionConfig'
import type { MotionEffectiveThresholds, NormalizedMotionSample } from './motionTypes'

/**
 * 손동작 인식기의 **센서 워밍업 교정** — 조용한 구간을 재서 임계값을 올린다.
 *
 * 인식기(`MotionGestureRecognizer.ts`)에서 갈라 둔 이유: 교정은 "장치의 바닥 소음이
 * 얼마인가"만 재는 통계이고, 인식은 "그 위에서 무슨 동작이 일어났는가"를 판정한다.
 * 두 관심사를 한 클래스에 두면 임계값을 조정할 때 상태 기계를 지나쳐야 한다.
 */

interface TimedValue {
  at: number
  value: number
}

const QUIET_SAMPLE_RATIO = 0.6
const MAX_NOISE_RMS = 2.5
const MAX_NOISE_JERK = 120

/** 교정 전 기본값 — 설정값을 그대로 쓴다. */
export const baseThresholds = (config: MotionGestureConfig): MotionEffectiveThresholds => ({
  shakeMinRms: config.shakeMinRms,
  shakePeak: config.shakePeakThreshold,
  shakePeakRelease: config.shakePeakReleaseThreshold,
  throwImpulse: config.throwImpulseThreshold,
  throwJerk: config.throwJerkThreshold,
  throwPeak: config.throwPeakThreshold,
})

/** 조용한 구간의 하위 60%만 쓴 RMS — 큰 스파이크 하나가 바닥을 오염시키지 않게 한다. */
function quietRms(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = values.map(Math.abs).sort((left, right) => left - right)
  const quietCount = Math.max(1, Math.floor(sorted.length * QUIET_SAMPLE_RATIO))
  const quiet = sorted.slice(0, quietCount)
  return Math.sqrt(quiet.reduce((sum, value) => sum + value ** 2, 0) / quiet.length)
}

function forwardJerks(values: TimedValue[]): number[] {
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

export class MotionCalibration {
  private magnitudes: number[] = []
  private forwards: TimedValue[] = []
  private thresholds: MotionEffectiveThresholds

  constructor(private readonly config: MotionGestureConfig = MOTION_GESTURE_CONFIG) {
    this.thresholds = baseThresholds(config)
  }

  /** 지금 유효 임계값 — 교정이 끝나면 바닥 소음만큼 올라가 있다. */
  get effectiveThresholds(): MotionEffectiveThresholds {
    return this.thresholds
  }

  collect(sample: NormalizedMotionSample): void {
    this.magnitudes.push(sample.magnitude)
    this.forwards.push({ at: sample.at, value: sample.forward })
  }

  /**
   * 교정 완료 — 바닥 소음의 배수로 임계값을 올린다.
   *
   * 계수(2.5·4·1.5·3·7)는 실측에서 온 값이다: 조용한 손의 RMS가 커지는 기기에서
   * 기본 임계값이면 걸음·숨결에도 흔들림이 잡혔다. 값을 낮추면 오탐이, 높이면
   * 인식 실패가 늘어난다.
   */
  complete(): MotionEffectiveThresholds {
    const noiseRms = this.noiseRms
    const noiseJerk = Math.min(MAX_NOISE_JERK, quietRms(forwardJerks(this.forwards)))
    const impulseNoise = noiseRms * (this.config.throwImpulseWindowMs / 1_000) * 3
    this.thresholds = {
      shakeMinRms: Math.max(this.config.shakeMinRms, noiseRms * 2.5),
      shakePeak: Math.max(this.config.shakePeakThreshold, noiseRms * 4),
      shakePeakRelease: Math.max(this.config.shakePeakReleaseThreshold, noiseRms * 1.5),
      throwImpulse: Math.max(this.config.throwImpulseThreshold, impulseNoise),
      throwJerk: Math.max(this.config.throwJerkThreshold, noiseJerk * 3),
      throwPeak: Math.max(this.config.throwPeakThreshold, noiseRms * 7),
    }
    return this.thresholds
  }

  /** 지금까지 모인 조용한 샘플의 RMS(상한 클램프). 스냅샷·진단용이다. */
  get noiseRms(): number {
    return Math.min(MAX_NOISE_RMS, quietRms(this.magnitudes))
  }

  /** 처음 상태로 — 재교정이 필요할 때(권한 재요청·화면 재진입) 부른다. */
  reset(): void {
    this.magnitudes = []
    this.forwards = []
    this.thresholds = baseThresholds(this.config)
  }
}
