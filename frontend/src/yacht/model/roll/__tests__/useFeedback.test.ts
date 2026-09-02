import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRollFeedback } from '@/yacht/feedback/createRollFeedback'
import { createHandVoice } from '@/yacht/feedback/handVoice'
import { useRollFeedback } from '@/yacht/model/roll/useFeedback'

const { feedback, voice } = vi.hoisted(() => ({
  feedback: {
    armed: vi.fn(),
    diceImpact: vi.fn(),
    dispose: vi.fn(),
    error: vi.fn(),
    phaseChanged: vi.fn(),
    remoteShakePulse: vi.fn(),
    setMuted: vi.fn(),
    shakePulse: vi.fn(),
    thrown: vi.fn(),
  },
  voice: { dispose: vi.fn(), play: vi.fn(), setMuted: vi.fn() },
}))

vi.mock('@/yacht/feedback/createRollFeedback', () => ({
  createRollFeedback: vi.fn(() => feedback),
}))
vi.mock('@/yacht/feedback/handVoice', () => ({ createHandVoice: vi.fn(() => voice) }))
vi.mock('@/shared/audio/soundPreference', () => ({ readSoundMuted: vi.fn(() => false) }))

afterEach(() => vi.clearAllMocks())

describe('useRollFeedback 흔들림', () => {
  it('내가 흔들면 방향과 세기를 그대로, 남이 흔들면 사실만 전한다', () => {
    const { result } = renderHook(() => useRollFeedback())

    act(() => result.current.pulse('left', 0.4, 'local'))
    expect(feedback.shakePulse).toHaveBeenCalledWith('left', 0.4)
    expect(result.current.motionPulse).toMatchObject({ direction: 'left', id: 1, strength: 0.4 })

    act(() => result.current.pulse('right', 0.9, 'remote'))
    expect(feedback.remoteShakePulse).toHaveBeenCalledOnce()
    // 남의 흔들림도 화면은 똑같이 흔들려야 하므로 펄스 번호는 이어진다.
    expect(result.current.motionPulse).toMatchObject({ direction: 'right', id: 2 })
    expect(feedback.shakePulse).toHaveBeenCalledOnce()
  })
})

describe('useRollFeedback 족보 알림', () => {
  it('특별한 족보가 나오면 띄우고 목소리로 알린 뒤 지울 수 있다', () => {
    const { result } = renderHook(() => useRollFeedback())

    act(() => result.current.highlightSpecialHand([6, 6, 6, 6, 6], () => false))

    expect(result.current.rollHighlight?.hand).toBe('yacht')
    expect(voice.play).toHaveBeenCalledWith('yacht')

    act(() => result.current.dismissHighlight())
    expect(result.current.rollHighlight).toBeNull()
  })

  it('이미 기록한 족보와 평범한 눈에는 아무 말도 하지 않는다', () => {
    const { result } = renderHook(() => useRollFeedback())

    act(() => result.current.highlightSpecialHand([6, 6, 6, 6, 6], () => true))
    expect(result.current.rollHighlight).toBeNull()

    act(() => result.current.highlightSpecialHand([1, 2, 3, 5, 6], () => false))
    expect(result.current.rollHighlight).toBeNull()
    expect(voice.play).not.toHaveBeenCalled()
  })
})

describe('useRollFeedback 나머지 위임', () => {
  it('소리 갈래를 그대로 넘기고, 화면이 사라지면 둘 다 정리한다', () => {
    const { result, unmount } = renderHook(() => useRollFeedback())

    act(() => {
      result.current.armed()
      result.current.diceImpact(0, 0.7)
      result.current.physicsError()
      result.current.phaseChanged('shaking')
      result.current.setMuted(true)
    })

    expect(feedback.armed).toHaveBeenCalledOnce()
    expect(feedback.diceImpact).toHaveBeenCalledWith(0, 0.7)
    expect(feedback.error).toHaveBeenCalledOnce()
    expect(feedback.phaseChanged).toHaveBeenCalledWith('shaking')
    expect(feedback.setMuted).toHaveBeenCalledWith(true)
    expect(voice.setMuted).toHaveBeenCalledWith(true)

    unmount()
    expect(feedback.dispose).toHaveBeenCalled()
    expect(voice.dispose).toHaveBeenCalled()
  })

  it('소리 도구는 화면당 한 번만 만든다', () => {
    const { rerender } = renderHook(() => useRollFeedback())

    rerender()

    expect(createRollFeedback).toHaveBeenCalledOnce()
    expect(createHandVoice).toHaveBeenCalledOnce()
  })
})
