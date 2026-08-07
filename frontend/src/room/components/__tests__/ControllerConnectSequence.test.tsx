import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ControllerConnectSequence } from '@/room/components/ControllerConnectSequence'
import { CONNECTED_HOLD_MS, CONNECTING_MIN_MS } from '@/room/connectSequence'

/** 두 지연을 다 넘겨 마지막 단계까지 보낸다. */
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

  // 연결이 순식간에 끝나도 '연결 중'을 건너뛰지 않는다 — 깜빡이고 지나가면 사용자는
  // 아무 일도 없었다고 읽는다.
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

  // 재연결은 처음 연결과 같은 안내를 다시 탄다 — 끊긴 것을 알리지 않으면 폰을 흔들어도
  // 아무 일이 없는 이유를 알 수 없다.
  it('연결이 끊기면 연결 중으로 되돌아간다', () => {
    const { rerender } = render(<ControllerConnectSequence status="connected" />)
    runSequence()
    expect(screen.getByRole('status')).toHaveTextContent('방장이 시작하면 바로 이어져요')

    rerender(<ControllerConnectSequence status="reconnecting" />)
    expect(screen.getByRole('status')).toHaveTextContent('컨트롤러를 방에 연결하고 있어요')
  })

  // 슬롯 계약: 사용법은 마지막 단계에서만 편다.
  it('게임별 사용법은 준비 완료 단계에서만 보인다', () => {
    render(
      <ControllerConnectSequence howTo={<p>폰을 흔들어 주사위를 굴려요</p>} status="connected" />,
    )
    expect(screen.queryByText('폰을 흔들어 주사위를 굴려요')).not.toBeInTheDocument()

    runSequence()
    expect(screen.getByText('폰을 흔들어 주사위를 굴려요')).toBeVisible()
  })
})
