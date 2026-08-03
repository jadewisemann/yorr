import { describe, expect, it } from 'vitest'
import {
  createRecording,
  type MotionRecordingSample,
  parseRecording,
  replayRecording,
  serializeRecording,
} from '@/app/dev/motionLabReplay'
import { MOTION_GESTURE_CONFIG } from '@/yacht/input/motionConfig'

/**
 * 합성 녹화: 20ms 간격, 워밍업 침묵 → 좌우 흔들기 5회 → 전방 스냅.
 * 기본 config 기준으로 shakeStarted(4번째 피크)와 throwDetected가 나와야 하는 시나리오.
 */
function buildThrowRecording() {
  const samples: MotionRecordingSample[] = []
  const push = (t: number, x: number, y: number) => {
    samples.push({ t, acc: [x, y, 0], accG: null, angle: 0 })
  }

  // 워밍업·캘리브레이션 (0~380ms): 정지 상태
  for (let t = 0; t <= 380; t += 20) push(t, 0, 0)

  // 흔들기: 240ms 주기 × 5, 피크 ±9 m/s² 4샘플 + 침묵 8샘플
  for (let cycle = 0; cycle < 5; cycle += 1) {
    const start = 400 + cycle * 240
    const sign = cycle % 2 === 0 ? 1 : -1
    for (let i = 0; i < 4; i += 1) push(start + i * 20, sign * 9, 0)
    for (let i = 4; i < 12; i += 1) push(start + i * 20, 0, 0)
  }

  // 던지기: 전방(-y) 가속 램프 — 임펄스·저크·피크를 동시에 충족
  push(1_600, 0, 0)
  push(1_620, 0, -6)
  push(1_640, 0, -14)
  push(1_660, 0, -22)
  push(1_680, 0, -30)
  push(1_700, 0, -30)
  for (let t = 1_720; t <= 1_800; t += 20) push(t, 0, 0)

  return createRecording(samples, '2026-07-29T00:00:00.000Z', 'test-agent')
}

describe('replayRecording', () => {
  it('기본 config에서 흔들기 시작과 던지기를 재현한다', () => {
    const result = replayRecording(buildThrowRecording(), MOTION_GESTURE_CONFIG)
    const types = result.events.map((event) => event.type)

    expect(types).toContain('shakeStarted')
    expect(types.filter((type) => type === 'throwDetected')).toHaveLength(1)

    const shakeStarted = result.events.find((event) => event.type === 'shakeStarted')
    const throwDetected = result.events.find((event) => event.type === 'throwDetected')
    expect(shakeStarted?.at).toBe(1_120)
    expect(throwDetected?.at).toBe(1_680)
  })

  it('던지기 임계값을 올리면 같은 녹화에서 던지기만 사라진다', () => {
    const result = replayRecording(buildThrowRecording(), {
      ...MOTION_GESTURE_CONFIG,
      throwImpulseThreshold: 5,
      throwPeakThreshold: 100,
    })
    const types = result.events.map((event) => event.type)

    expect(types).toContain('shakeStarted')
    expect(types).not.toContain('throwDetected')
  })

  it('흔들기 임계값을 올리면 아무 제스처도 시작되지 않는다', () => {
    const result = replayRecording(buildThrowRecording(), {
      ...MOTION_GESTURE_CONFIG,
      shakePeakThreshold: 15,
    })
    const types = result.events.map((event) => event.type)

    expect(types).not.toContain('shakeStarted')
    expect(types).not.toContain('throwDetected')
  })

  it('동일 입력·동일 config면 결과가 결정적이다', () => {
    const recording = buildThrowRecording()
    const first = replayRecording(recording, MOTION_GESTURE_CONFIG)
    const second = replayRecording(recording, MOTION_GESTURE_CONFIG)
    expect(second.events).toEqual(first.events)
  })
})

describe('parseRecording', () => {
  it('직렬화 왕복이 손실 없이 동작한다', () => {
    const recording = buildThrowRecording()
    expect(parseRecording(serializeRecording(recording))).toEqual(recording)
  })

  it('JSON이 아니면 안내 메시지와 함께 실패한다', () => {
    expect(() => parseRecording('not-json')).toThrow('JSON을 읽을 수 없어요')
  })

  it('다른 형식의 JSON이면 거부한다', () => {
    expect(() => parseRecording('{"type":"something-else"}')).toThrow('모션 녹화 파일')
    expect(() =>
      parseRecording('{"type":"yorr-motion-recording","version":1,"samples":[]}'),
    ).toThrow('샘플이 비어')
  })
})
