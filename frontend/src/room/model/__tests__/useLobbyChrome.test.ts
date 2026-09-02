import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLobbyChrome } from '@/room/model/useLobbyChrome'
import { readSoundMuted, saveSoundMuted } from '@/shared/audio/soundPreference'
import { setSoundtrackMuted } from '@/shared/audio/soundtrack'

vi.mock('@/shared/audio/soundPreference', () => ({
  readSoundMuted: vi.fn(() => false),
  saveSoundMuted: vi.fn(),
}))

vi.mock('@/shared/audio/soundtrack', () => ({ setSoundtrackMuted: vi.fn() }))

afterEach(() => vi.clearAllMocks())

describe('useLobbyChrome', () => {
  it('두 팝오버는 서로 간섭하지 않고 각자 여닫힌다', () => {
    const { result } = renderHook(() => useLobbyChrome())

    expect(result.current.audio.open).toBe(false)
    expect(result.current.invite.open).toBe(false)

    act(() => result.current.audio.show())
    expect(result.current.audio.open).toBe(true)
    expect(result.current.invite.open).toBe(false)

    act(() => result.current.invite.show())
    act(() => result.current.audio.close())
    expect(result.current.audio.open).toBe(false)
    expect(result.current.invite.open).toBe(true)
  })

  it('나가기 확인은 요청과 취소를 오간다', () => {
    const { result } = renderHook(() => useLobbyChrome())

    act(() => result.current.requestExit())
    expect(result.current.exitRequested).toBe(true)

    act(() => result.current.cancelExit())
    expect(result.current.exitRequested).toBe(false)
  })

  it('음소거는 저장한 값에서 출발해 화면·설정·재생을 함께 바꾼다', () => {
    vi.mocked(readSoundMuted).mockReturnValue(true)
    const { result } = renderHook(() => useLobbyChrome())

    expect(result.current.soundMuted).toBe(true)

    act(() => result.current.toggleMute())

    expect(result.current.soundMuted).toBe(false)
    expect(saveSoundMuted).toHaveBeenCalledWith(false)
    expect(setSoundtrackMuted).toHaveBeenCalledWith(false)
  })
})
