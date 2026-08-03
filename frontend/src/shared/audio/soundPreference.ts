const soundMutedStorageKey = 'yorr.sound-muted'

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * 소리 음소거 선택은 방을 옮겨도 유지한다 — 조용한 곳에서 한 번 끈 사람에게
 * 다음 게임에서 다시 소리를 내면 그게 곧 버그로 읽힌다. 기본값은 "소리 켜짐"이다.
 */
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
  } catch {
    // 사파리 프라이빗 모드 등 쓰기가 막힌 환경. 이번 세션 동안만 적용되면 충분하다.
  }
}

function getLocalStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}
