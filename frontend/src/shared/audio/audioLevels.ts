const storageKey = 'yorr.audio-levels'

/**
 * 배경음·효과음 볼륨. 값은 **이미 튜닝된 기본 믹스에 곱하는 배율**(0~1)이지 절대 볼륨이 아니다.
 *
 * 배율로 둔 이유: 효과음은 사발 흔들기 0.5 · 쏟기 0.7 · 주사위 충돌 0.15~0.8처럼 서로
 * 다르게 맞춰져 있다. 슬라이더가 절대값을 쓰면 그 균형이 무너진다. 1.0이 지금 들리는 소리고,
 * 슬라이더는 "여기서 얼마나 줄일지"를 정한다(키우려면 기기 볼륨을 쓴다 — 1을 넘기면
 * 효과음이 서로를 덮고 클리핑이 난다).
 */
export interface AudioLevels {
  music: number
  effects: number
}

const DEFAULT_LEVELS: AudioLevels = { effects: 1, music: 1 }

// 재생마다 localStorage를 읽으면 안 된다(주사위 충돌음은 한 굴림에 여러 번 난다).
// 값은 메모리에 들고, 저장소는 세션 사이 복원에만 쓴다.
let levels: AudioLevels | null = null

function clamp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(1, Math.max(0, value))
}

function load(): AudioLevels {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(storageKey) ?? 'null')
    if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_LEVELS }
    const stored = raw as Partial<Record<keyof AudioLevels, unknown>>
    return {
      effects: clamp(stored.effects) ?? DEFAULT_LEVELS.effects,
      music: clamp(stored.music) ?? DEFAULT_LEVELS.music,
    }
  } catch {
    // 사파리 프라이빗 모드 등 접근이 막힌 환경. 기본 믹스로 돈다.
    return { ...DEFAULT_LEVELS }
  }
}

export function audioLevels(): AudioLevels {
  levels ??= load()
  return levels
}

/** 배경음 배율. soundtrack이 트랙 볼륨에 곱한다. */
export function musicLevel(): number {
  return audioLevels().music
}

/** 효과음(주사위·족보 음성) 배율. 재생 시점에 곱한다 — 값이 바뀌면 다음 소리부터 반영된다. */
export function effectsLevel(): number {
  return audioLevels().effects
}

export function setAudioLevel(kind: keyof AudioLevels, value: number): void {
  const next = { ...audioLevels(), [kind]: clamp(value) ?? DEFAULT_LEVELS[kind] }
  levels = next
  try {
    globalThis.localStorage?.setItem(storageKey, JSON.stringify(next))
  } catch {
    // 쓰기가 막혀도 이번 세션에는 적용된다.
  }
}
