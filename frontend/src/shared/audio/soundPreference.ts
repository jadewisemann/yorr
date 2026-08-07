const soundMutedStorageKey = 'yorr.sound-muted'

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function readSoundMuted(storage = getLocalStorage()): boolean {
  try {
    return storage?.getItem(soundMutedStorageKey) === 'true'
  } catch {
    return false
  }
}

export function saveSoundMuted(muted: boolean, storage = getLocalStorage()): void {
  try {
    storage?.setItem(soundMutedStorageKey, String(muted))
  } catch {}
}

function getLocalStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}
