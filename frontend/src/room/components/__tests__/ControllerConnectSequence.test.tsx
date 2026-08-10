import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ControllerConnectSequence } from '@/room/components/ControllerConnectSequence'
import { CONNECTED_HOLD_MS, CONNECTING_MIN_MS } from '@/room/connectSequence'

function runSequence(ms = CONNECTING_MIN_MS + CONNECTED_HOLD_MS) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('ControllerConnectSequence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', Object.assign(navigator, { vibrate: vi.fn() }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('연결된 직후에도 최소 노출 시간 동안 연결 중에 머문다', () => {
    render(<ControllerConnectSequence status="connected" />)
    expect(screen.getByRole('status')).toHaveTextContent('컨트롤러를 방에 연결하고 있어요')

    runSequence(CONNECTING_MIN_MS)
    expect(screen.getByRole('status')).toHaveTextContent('이 폰이 컨트롤러가 됐어요')

    runSequence(CONNECTED_HOLD_MS)
    expect(screen.getByRole('status')).toHaveTextContent('방장이 시작하면 바로 이어져요')
  })

  it('연결된 순간 한 번만 진동한다', () => {
    render(<ControllerConnectSequence status="connected" />)
    expect(navigator.vibrate).not.toHaveBeenCalled()

    runSequence()
    expect(navigator.vibrate).toHaveBeenCalledTimes(1)
  })

  it('연결이 끊기면 연결 중으로 되돌아간다', () => {
    const { rerender } = render(<ControllerConnectSequence status="connected" />)
    runSequence()
    expect(screen.getByRole('status')).toHaveTextContent('방장이 시작하면 바로 이어져요')

    rerender(<ControllerConnectSequence status="reconnecting" />)
    expect(screen.getByRole('status')).toHaveTextContent('컨트롤러를 방에 연결하고 있어요')
  })

  it('게임별 사용법은 준비 완료 단계에서만 보인다', () => {
    render(
      <ControllerConnectSequence howTo={<p>폰을 흔들어 주사위를 굴려요</p>} status="connected" />,
    )
    expect(screen.queryByText('폰을 흔들어 주사위를 굴려요')).not.toBeInTheDocument()

    runSequence()
    expect(screen.getByText('폰을 흔들어 주사위를 굴려요')).toBeVisible()
  })
})
