import { render, renderHook, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastHost, useToast } from '@/shared/components/ToastHost'

describe('ToastHost', () => {
  it('메시지가 있을 때만 보여준다', () => {
    const { rerender } = render(<ToastHost message={null} />)
    expect(screen.queryByRole('status')).not.toHaveTextContent(/./)

    rerender(<ToastHost message="저장했어요" />)
    expect(screen.getByRole('status')).toHaveTextContent('저장했어요')
  })
})

describe('useToast', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('showToast 호출 시 메시지를 담고 일정 시간 뒤 스스로 지운다', () => {
    const { result } = renderHook(() => useToast())

    act(() => result.current.showToast('저장했어요'))
    expect(result.current.message).toBe('저장했어요')

    act(() => vi.advanceTimersByTime(2_500))
    expect(result.current.message).toBeNull()
  })

  it('새 토스트가 오면 이전 타이머를 취소하고 새로 카운트한다', () => {
    const { result } = renderHook(() => useToast())

    act(() => result.current.showToast('첫 번째'))
    act(() => vi.advanceTimersByTime(2_000))
    act(() => result.current.showToast('두 번째'))
    act(() => vi.advanceTimersByTime(2_000))

    // 첫 토스트의 타이머(2_500ms)가 그대로였다면 이 시점에 이미 지워졌을 것이다.
    expect(result.current.message).toBe('두 번째')
  })
})
