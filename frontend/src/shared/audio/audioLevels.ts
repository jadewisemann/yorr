const storageKey = 'yorr.audio-levels'

export interface AudioLevels {
  music: number
  effects: number
}

const DEFAULT_LEVELS: AudioLevels = { effects: 1, music: 1 }

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
    return { ...DEFAULT_LEVELS }
  }
}

export function audioLevels(): AudioLevels {
  levels ??= load()
  return levels
}

export function musicLevel(): number {
  return audioLevels().music
}

export function effectsLevel(): number {
  return audioLevels().effects
}

export function setAudioLevel(kind: keyof AudioLevels, value: number): void {
  const next = { ...audioLevels(), [kind]: clamp(value) ?? DEFAULT_LEVELS[kind] }
  levels = next
  try {
    globalThis.localStorage?.setItem(storageKey, JSON.stringify(next))
  } catch {}
}
