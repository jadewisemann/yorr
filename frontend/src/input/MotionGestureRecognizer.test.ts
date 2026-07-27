import { describe, expect, it } from 'vitest'
import { MotionGestureRecognizer } from './MotionGestureRecognizer'
import type { MotionGestureEvent, NormalizedMotionSample } from './motionTypes'

describe('MotionGestureRecognizer', () => {
  it('조용한 기기에서는 기본 임계값을 유지한다', () => {
    const recognizer = new MotionGestureRecognizer()
    feed(recognizer, [
      noiseSample(0, 0.2),
      noiseSample(50, 0.2),
      noiseSample(100, 0.2),
      noiseSample(150, 0.2),
      noiseSample(200, 0.2),
      noiseSample(250, 0.2),
      sample(300),
    ])

    expect(recognizer.getSnapshot()).toMatchObject({
      calibrated: true,
      effectiveThresholds: {
        shakeMinRms: 3.5,
        shakePeak: 6,
        throwImpulse: 0.9,
        throwJerk: 70,
        throwPeak: 12,
      },
    })
  })

  it('노이즈가 큰 기기에서는 제스처 임계값을 자동으로 높인다', () => {
    const recognizer = new MotionGestureRecognizer()
    feed(recognizer, [
      noiseSample(0, 2),
      noiseSample(50, 2),
      noiseSample(100, 2),
      noiseSample(150, 2),
      noiseSample(200, 2),
      noiseSample(250, 2),
      sample(300),
    ])

    expect(recognizer.getSnapshot()).toMatchObject({
      calibrated: true,
      noiseRms: 2,
      effectiveThresholds: {
        shakeMinRms: 5,
        shakePeak: 8,
        throwPeak: 14,
      },
    })
  })

  it('보정 중 한 번의 큰 충격은 저잡음 표본 계산에서 제외한다', () => {
    const recognizer = new MotionGestureRecognizer()
    feed(recognizer, [
      noiseSample(0, 0.2),
      noiseSample(50, 0.2),
      noiseSample(100, 20),
      noiseSample(150, 0.2),
      noiseSample(200, 0.2),
      noiseSample(250, 0.2),
      sample(300),
    ])

    expect(recognizer.getSnapshot().effectiveThresholds.shakePeak).toBe(6)
  })

  it('좌우 반전이 성립한 뒤에만 흔들기를 시작한다', () => {
    const recognizer = new MotionGestureRecognizer()
    const events = feed(recognizer, validShake())

    expect(events.filter((event) => event.type === 'shakeStarted')).toHaveLength(1)
    expect(recognizer.getSnapshot().gestureState).toBe('shaking')
    expect(recognizer.getSnapshot().reversalCount).toBe(3)
  })

  it('같은 방향의 충격과 흔들기 없는 전방 움직임은 던지지 않는다', () => {
    const recognizer = new MotionGestureRecognizer()
    const events = feed(recognizer, [
      sample(0),
      sample(300, 7),
      sample(350),
      sample(500, 8),
      sample(550),
      sample(700, 9),
      sample(900, 0, 18),
      sample(920, 0, 18),
      sample(940, 0, 18),
      sample(960, 0, 20),
    ])

    expect(events.some((event) => event.type === 'shakeStarted')).toBe(false)
    expect(events.some((event) => event.type === 'throwDetected')).toBe(false)
  })

  it('유효한 흔들기 뒤 peak, impulse, jerk가 맞으면 한 번만 던진다', () => {
    const recognizer = new MotionGestureRecognizer()
    const events = feed(recognizer, [
      ...validShake(),
      sample(1_000, 0, 12),
      sample(1_020, 0, 12),
      sample(1_040, 0, 12),
      sample(1_060, 0, 14),
      sample(1_080, 0, 20),
    ])

    expect(events.filter((event) => event.type === 'throwDetected')).toHaveLength(1)
    expect(recognizer.getSnapshot().gestureState).toBe('cooldown')
  })

  it('흔들기를 멈추면 확정 가능한 armed 상태를 유지한다', () => {
    const recognizer = new MotionGestureRecognizer()
    const events = feed(recognizer, [...validShake(), sample(1_700)])

    expect(events.some((event) => event.type === 'shakeArmed')).toBe(true)
    expect(recognizer.getSnapshot()).toMatchObject({
      canConfirmThrow: true,
      gestureState: 'armed',
    })
  })
})

function validShake(): NormalizedMotionSample[] {
  return [
    sample(0),
    sample(300, 7),
    sample(350),
    sample(460, -7),
    sample(510),
    sample(620, 7),
    sample(670),
    sample(780, -7),
  ]
}

function sample(at: number, horizontal = 0, forward = 0): NormalizedMotionSample {
  return {
    at,
    dt: 20,
    forward,
    horizontal,
    magnitude: Math.hypot(horizontal, forward),
  }
}

function noiseSample(at: number, magnitude: number): NormalizedMotionSample {
  return {
    at,
    dt: 50,
    forward: 0,
    horizontal: 0,
    magnitude,
  }
}

function feed(recognizer: MotionGestureRecognizer, samples: NormalizedMotionSample[]) {
  const events: MotionGestureEvent[] = []
  for (const value of samples) events.push(...recognizer.push(value))
  return events
}
