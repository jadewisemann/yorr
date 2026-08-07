import { MOTION_GESTURE_CONFIG, type MotionGestureConfig } from '@/yacht/input/motionConfig'

export type MotionParamKey = keyof MotionGestureConfig
export type MotionParamGroup = 'shake' | 'throw' | 'timing'

export interface MotionParamMeta {
  key: MotionParamKey
  group: MotionParamGroup
  label: string
  description: string
  min: number
  max: number
  step: number
}

export const MOTION_PARAM_GROUPS: Record<MotionParamGroup, string> = {
  shake: '흔들기 판정',
  throw: '던지기 판정',
  timing: '타이밍',
}

/** 슬라이더 순서 = 튜닝 빈도 순. 범위는 기본값이 중앙 근처에 오도록 잡았다. */
export const MOTION_PARAM_METAS: readonly MotionParamMeta[] = [
  {
    key: 'shakePeakThreshold',
    group: 'shake',
    label: '흔들기 피크 임계값',
    description: '좌우 가속도가 이 값(m/s²)을 넘어야 피크로 인정',
    min: 1,
    max: 20,
    step: 0.5,
  },
  {
    key: 'shakePeakReleaseThreshold',
    group: 'shake',
    label: '피크 해제 임계값',
    description: '다음 피크를 인정하기 전에 이 값 아래로 복귀해야 함 (히스테리시스)',
    min: 0.5,
    max: 10,
    step: 0.5,
  },
  {
    key: 'shakeMinRms',
    group: 'shake',
    label: '최소 수평 RMS',
    description: 'shaking 진입에 필요한 윈도우 평균 에너지',
    min: 0.5,
    max: 15,
    step: 0.5,
  },
  {
    key: 'shakeRequiredReversals',
    group: 'shake',
    label: '필요 방향 반전 수',
    description: '좌↔우 방향 전환이 이 횟수 이상이어야 shaking 시작',
    min: 1,
    max: 8,
    step: 1,
  },
  {
    key: 'shakeMinPeakGapMs',
    group: 'shake',
    label: '피크 최소 간격 (ms)',
    description: '이보다 짧은 간격의 피크는 무시 (디바운스)',
    min: 40,
    max: 400,
    step: 10,
  },
  {
    key: 'shakeMaxPeakGapMs',
    group: 'shake',
    label: '피크 최대 간격 (ms)',
    description: '이보다 오래 피크가 없으면 흔들기 후보 리셋',
    min: 200,
    max: 1_500,
    step: 50,
  },
  {
    key: 'shakeWindowMs',
    group: 'shake',
    label: 'RMS 윈도우 (ms)',
    description: '수평 RMS를 계산하는 시간 창',
    min: 400,
    max: 3_000,
    step: 100,
  },
  {
    key: 'shakeLostMs',
    group: 'shake',
    label: '흔들기 유실 시간 (ms)',
    description: '마지막 피크 후 이 시간이 지나면 armed(던지기 대기)로 전환',
    min: 300,
    max: 3_000,
    step: 100,
  },
  {
    key: 'throwPeakThreshold',
    group: 'throw',
    label: '던지기 피크 임계값',
    description: '전방 가속도가 이 값(m/s²)을 넘어야 던지기 후보',
    min: 3,
    max: 30,
    step: 0.5,
  },
  {
    key: 'throwImpulseThreshold',
    group: 'throw',
    label: '임펄스 임계값',
    description: '윈도우 내 전방 가속도 적분값(m/s) 하한',
    min: 0.1,
    max: 5,
    step: 0.1,
  },
  {
    key: 'throwImpulseWindowMs',
    group: 'throw',
    label: '임펄스 윈도우 (ms)',
    description: '임펄스를 적분하는 시간 창',
    min: 60,
    max: 600,
    step: 20,
  },
  {
    key: 'throwJerkThreshold',
    group: 'throw',
    label: '저크 임계값',
    description: '가속도 변화율(m/s³) 하한 — 급격한 스냅만 인정',
    min: 10,
    max: 300,
    step: 5,
  },
  {
    key: 'throwDirectionRatio',
    group: 'throw',
    label: '방향 순도 비율',
    description: '전방 성분 / 전체 크기 비율 하한 — 비스듬한 동작 걸러냄',
    min: 0.1,
    max: 1,
    step: 0.05,
  },
  {
    key: 'throwArmDelayMs',
    group: 'throw',
    label: '던지기 대기 시간 (ms)',
    description: 'shaking 시작 후 이 시간 동안은 던지기 판정 안 함',
    min: 0,
    max: 1_000,
    step: 20,
  },
  {
    key: 'throwTimeoutMs',
    group: 'timing',
    label: '흔들기 타임아웃 (ms)',
    description: 'shaking이 이 시간을 넘으면 armed로 전환',
    min: 1_000,
    max: 10_000,
    step: 250,
  },
  {
    key: 'sensorWarmupMs',
    group: 'timing',
    label: '워밍업 시간 (ms)',
    description: '시작 직후 노이즈 캘리브레이션에 쓰는 시간',
    min: 0,
    max: 2_000,
    step: 50,
  },
  {
    key: 'cooldownMs',
    group: 'timing',
    label: '쿨다운 (ms)',
    description: 'throwDetected 후 다음 판정까지 대기 시간',
    min: 200,
    max: 5_000,
    step: 100,
  },
]

const STORAGE_KEY = 'yorr.motion-lab.config.v1'

export function clampParamValue(meta: MotionParamMeta, value: number): number {
  if (!Number.isFinite(value)) return MOTION_GESTURE_CONFIG[meta.key]
  const clamped = Math.min(meta.max, Math.max(meta.min, value))
  return meta.step >= 1 ? Math.round(clamped) : clamped
}

/** 저장값·수동 입력값을 안전한 config로 정리한다. 모르는 키는 버리고 빠진 키는 기본값. */
export function sanitizeConfig(raw: Partial<Record<string, unknown>>): MotionGestureConfig {
  const config = { ...MOTION_GESTURE_CONFIG }
  for (const meta of MOTION_PARAM_METAS) {
    const value = raw[meta.key]
    if (typeof value === 'number') config[meta.key] = clampParamValue(meta, value)
  }
  return config
}

export function loadStoredConfig(): MotionGestureConfig {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...MOTION_GESTURE_CONFIG }
    return sanitizeConfig(JSON.parse(raw))
  } catch {
    return { ...MOTION_GESTURE_CONFIG }
  }
}

export function storeConfig(config: MotionGestureConfig) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // 저장 불가(사생활 모드 등)여도 페이지 동작에는 지장 없음
  }
}

export function isDefaultValue(key: MotionParamKey, value: number) {
  return value === MOTION_GESTURE_CONFIG[key]
}

const sortedKeys = Object.keys(MOTION_GESTURE_CONFIG).sort() as MotionParamKey[]

/** 1200 → "1_200" — motionConfig.ts의 숫자 표기와 동일하게. */
function formatTsNumber(value: number) {
  if (!Number.isInteger(value) || Math.abs(value) < 1_000) return String(value)
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '_')
}

/** motionConfig.ts의 MOTION_GESTURE_CONFIG 선언 자리에 그대로 붙여넣을 수 있는 TS 리터럴. */
export function formatConfigAsTs(config: MotionGestureConfig) {
  const lines = sortedKeys.map((key) => `  ${key}: ${formatTsNumber(config[key])},`)
  return [
    'export const MOTION_GESTURE_CONFIG: MotionGestureConfig = Object.freeze({',
    ...lines,
    '})',
  ].join('\n')
}

export function formatConfigAsJson(config: MotionGestureConfig) {
  const ordered: Record<string, number> = {}
  for (const key of sortedKeys) ordered[key] = config[key]
  return JSON.stringify(ordered, null, 2)
}

/** 기본값과 다른 항목만 "키: 기본 → 현재" 형태로. 변경이 없으면 빈 문자열. */
export function formatConfigDiff(config: MotionGestureConfig) {
  return sortedKeys
    .filter((key) => config[key] !== MOTION_GESTURE_CONFIG[key])
    .map((key) => `${key}: ${MOTION_GESTURE_CONFIG[key]} → ${config[key]}`)
    .join('\n')
}
