import { MotionGestureRecognizer } from '@/yacht/input/MotionGestureRecognizer'
import type { MotionGestureConfig } from '@/yacht/input/motionConfig'
import type { MotionGestureEvent } from '@/yacht/input/motionTypes'
import { MotionSampleNormalizer } from '@/yacht/input/normalizeMotionSample'

type Vec3 = [number, number, number]

export interface MotionRecordingSample {
  t: number
  acc: Vec3 | null
  accG: Vec3 | null
  angle: number
}

export interface MotionRecording {
  type: 'yorr-motion-recording'
  version: 1
  recordedAt: string
  userAgent: string
  samples: MotionRecordingSample[]
}

export function createRecording(
  samples: MotionRecordingSample[],
  recordedAt: string,
  userAgent: string,
): MotionRecording {
  return { type: 'yorr-motion-recording', version: 1, recordedAt, userAgent, samples }
}

export function serializeRecording(recording: MotionRecording) {
  return JSON.stringify(recording)
}

export function parseRecording(json: string): MotionRecording {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('JSON을 읽을 수 없어요. 내보내기한 내용을 그대로 붙여넣어 주세요.')
  }
  const record = parsed as Partial<MotionRecording>
  if (record?.type !== 'yorr-motion-recording' || record.version !== 1) {
    throw new Error('모션 녹화 파일(v1)이 아니에요.')
  }
  if (!Array.isArray(record.samples) || record.samples.length === 0) {
    throw new Error('샘플이 비어 있는 녹화예요.')
  }
  for (const sample of record.samples) {
    if (typeof sample?.t !== 'number' || !isVecOrNull(sample.acc) || !isVecOrNull(sample.accG)) {
      throw new Error('샘플 형식이 올바르지 않아요.')
    }
  }
  return {
    type: 'yorr-motion-recording',
    version: 1,
    recordedAt: typeof record.recordedAt === 'string' ? record.recordedAt : '',
    userAgent: typeof record.userAgent === 'string' ? record.userAgent : '',
    samples: record.samples,
  }
}

function isVecOrNull(value: unknown): value is Vec3 | null {
  if (value === null) return true
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number')
}

export interface ReplayResult {
  events: MotionGestureEvent[]
  durationMs: number
  sampleCount: number
}

export function replayRecording(
  recording: MotionRecording,
  config: MotionGestureConfig,
): ReplayResult {
  const normalizer = new MotionSampleNormalizer()
  const recognizer = new MotionGestureRecognizer(config)
  const events: MotionGestureEvent[] = []

  for (const raw of recording.samples) {
    const sample = normalizer.push(
      {
        acceleration: toAcceleration(raw.acc),
        accelerationIncludingGravity: toAcceleration(raw.accG),
        timeStamp: raw.t,
      },
      raw.angle,
    )
    if (!sample) continue
    events.push(...recognizer.push(sample))
  }

  const last = recording.samples[recording.samples.length - 1]
  return { events, durationMs: last ? last.t : 0, sampleCount: recording.samples.length }
}

function toAcceleration(vec: Vec3 | null) {
  return vec ? { x: vec[0], y: vec[1], z: vec[2] } : null
}
