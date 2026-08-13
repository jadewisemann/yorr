import { beforeEach, describe, expect, it } from 'vitest'
import {
  formatConfigAsJson,
  formatConfigAsTs,
  formatConfigDiff,
  loadStoredConfig,
  MOTION_PARAM_METAS,
  sanitizeConfig,
  storeConfig,
} from '@/app/dev/motionLabParams'
import { MOTION_GESTURE_CONFIG } from '@/yacht/input/motionConfig'

describe('MOTION_PARAM_METAS', () => {
  it('config의 모든 키를 정확히 한 번씩 다룬다', () => {
    const metaKeys = MOTION_PARAM_METAS.map((meta) => meta.key).sort()
    expect(metaKeys).toEqual(Object.keys(MOTION_GESTURE_CONFIG).sort())
  })

  it('기본값이 슬라이더 범위 안에 있다', () => {
    for (const meta of MOTION_PARAM_METAS) {
      const defaultValue = MOTION_GESTURE_CONFIG[meta.key]
      expect(defaultValue, meta.key).toBeGreaterThanOrEqual(meta.min)
      expect(defaultValue, meta.key).toBeLessThanOrEqual(meta.max)
    }
  })
})

describe('sanitizeConfig', () => {
  it('범위를 벗어난 값을 클램프하고 정수 파라미터를 반올림한다', () => {
    const config = sanitizeConfig({
      shakePeakThreshold: 999,
      shakeRequiredReversals: 2.6,
      throwDirectionRatio: -1,
    })
    expect(config.shakePeakThreshold).toBe(20)
    expect(config.shakeRequiredReversals).toBe(3)
    expect(config.throwDirectionRatio).toBe(0.1)
  })

  it('모르는 키와 숫자가 아닌 값은 무시하고 기본값을 쓴다', () => {
    const config = sanitizeConfig({ unknownKey: 1, cooldownMs: 'fast' })
    expect(config).toEqual(MOTION_GESTURE_CONFIG)
  })
})

describe('storeConfig / loadStoredConfig', () => {
  beforeEach(() => {
    const data = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
        removeItem: (key: string) => void data.delete(key),
        clear: () => data.clear(),
      },
    })
  })

  it('저장한 config를 그대로 복원한다', () => {
    const modified = { ...MOTION_GESTURE_CONFIG, shakePeakThreshold: 8.5 }
    storeConfig(modified)
    expect(loadStoredConfig()).toEqual(modified)
  })

  it('저장된 값이 없거나 깨져 있으면 기본값을 돌려준다', () => {
    expect(loadStoredConfig()).toEqual(MOTION_GESTURE_CONFIG)
    window.localStorage.setItem('yorr.motion-lab.config.v1', '{broken')
    expect(loadStoredConfig()).toEqual(MOTION_GESTURE_CONFIG)
  })
})

describe('내보내기 포맷', () => {
  it('TS 리터럴이 motionConfig.ts 표기(정렬·언더스코어)와 일치한다', () => {
    const ts = formatConfigAsTs(MOTION_GESTURE_CONFIG)
    expect(ts.startsWith('export const MOTION_GESTURE_CONFIG: MotionGestureConfig =')).toBe(true)
    expect(ts).toContain('  cooldownMs: 1_200,')
    expect(ts).toContain('  throwImpulseThreshold: 0.9,')
    expect(ts).toContain('  throwTimeoutMs: 4_000,')
    expect(ts.trimEnd().endsWith('})')).toBe(true)
  })

  it('JSON 포맷은 파싱 왕복이 가능하다', () => {
    const parsed = JSON.parse(formatConfigAsJson(MOTION_GESTURE_CONFIG))
    expect(parsed).toEqual(MOTION_GESTURE_CONFIG)
  })

  it('diff는 기본값과 다른 키만 나열한다', () => {
    expect(formatConfigDiff(MOTION_GESTURE_CONFIG)).toBe('')
    const diff = formatConfigDiff({ ...MOTION_GESTURE_CONFIG, throwPeakThreshold: 15 })
    expect(diff).toBe('throwPeakThreshold: 12 → 15')
  })
})
