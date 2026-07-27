import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PhysicsDiceFallback } from './PhysicsDiceFallback'

const request = {
  requestId: 'roll-73',
  seed: 73,
  targetDice: [6, 5, 4, 3, 2],
  held: [false, false, false, false, false],
} as const

describe('PhysicsDiceFallback', () => {
  it('같은 requestId 완료를 rerender해도 한 번만 알린다', () => {
    const onRollComplete = vi.fn()
    const frameCallbacks: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)

    const view = render(
      <PhysicsDiceFallback
        dice={null}
        held={request.held}
        releaseRequestId={null}
        request={request}
        onRollComplete={onRollComplete}
      />,
    )
    view.rerender(
      <PhysicsDiceFallback
        dice={null}
        held={request.held}
        releaseRequestId={request.requestId}
        request={request}
        onRollComplete={onRollComplete}
      />,
    )

    act(() => frameCallbacks[0]?.(0))
    expect(onRollComplete).toHaveBeenCalledOnce()
    expect(onRollComplete).toHaveBeenCalledWith('roll-73', request.targetDice)

    vi.restoreAllMocks()
  })

  it('완료 대기 중 callback이 바뀌어도 최신 callback으로 한 번 완료한다', () => {
    const initialCallback = vi.fn()
    const latestCallback = vi.fn()
    const frameCallbacks: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)

    const view = render(
      <PhysicsDiceFallback
        dice={null}
        held={request.held}
        releaseRequestId={request.requestId}
        request={request}
        onRollComplete={initialCallback}
      />,
    )
    view.rerender(
      <PhysicsDiceFallback
        dice={null}
        held={request.held}
        releaseRequestId={request.requestId}
        request={request}
        onRollComplete={latestCallback}
      />,
    )

    act(() => frameCallbacks[0]?.(0))

    expect(initialCallback).not.toHaveBeenCalled()
    expect(latestCallback).toHaveBeenCalledOnce()
    expect(latestCallback).toHaveBeenCalledWith('roll-73', request.targetDice)
    vi.restoreAllMocks()
  })
})
