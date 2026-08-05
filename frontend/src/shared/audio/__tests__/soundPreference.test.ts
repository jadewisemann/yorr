import { afterEach, describe, expect, it } from 'vitest'
import { readSoundMuted, saveSoundMuted } from '@/shared/audio/soundPreference'

afterEach(() => window.localStorage.clear())

describe('soundPreference', () => {
  it('기본값은 소리 켜짐이다', () => {
    expect(readSoundMuted()).toBe(false)
  })

  it('저장한 음소거 선택을 그대로 읽어온다', () => {
    saveSoundMuted(true)
    expect(readSoundMuted()).toBe(true)

    saveSoundMuted(false)
    expect(readSoundMuted()).toBe(false)
  })

  it('저장소를 쓸 수 없으면 조용히 기본값으로 넘어간다', () => {
    const broken = {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
    }

    expect(() => saveSoundMuted(true, broken)).not.toThrow()
    expect(readSoundMuted(broken)).toBe(false)
  })
})
