import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PhysicsDiceFallback } from '@/yacht/components/PhysicsDiceFallback'

const request = {
  requestId: 'roll-73',
  seed: 73,
  held: [false, false, false, false, false],
  targetDice: [6, 5, 4, 3, 2],
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

  it('같은 굴림이 새 객체로 들어와도 완료는 한 번만 알린다', () => {
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
        releaseRequestId={request.requestId}
        request={request}
        onRollComplete={onRollComplete}
      />,
    )
    view.rerender(
      <PhysicsDiceFallback
        dice={null}
        held={request.held}
        releaseRequestId={request.requestId}
        request={{ ...request }}
        onRollComplete={onRollComplete}
      />,
    )

    expect(frameCallbacks).toHaveLength(2)
    act(() => {
      frameCallbacks[0]?.(0)
      frameCallbacks[1]?.(0)
    })

    expect(onRollComplete).toHaveBeenCalledOnce()
    vi.restoreAllMocks()
  })

  it('굴린 적 없으면 초기 주사위 다섯 개를 보여 준다', () => {
    render(
      <PhysicsDiceFallback
        dice={null}
        held={request.held}
        releaseRequestId={null}
        request={null}
        onRollComplete={vi.fn()}
      />,
    )

    expect(screen.getByRole('region', { name: '2D 주사위 대체 화면' })).toBeVisible()
    expect(screen.getAllByRole('button')).toHaveLength(5)
    expect(screen.getByRole('img', { name: '주사위 1' })).toBeVisible()
    expect(screen.getByRole('img', { name: '주사위 5' })).toBeVisible()
  })

  it('확정된 주사위가 있으면 그 값을 보여 준다', () => {
    render(
      <PhysicsDiceFallback
        dice={[2, 2, 3, 4, 6]}
        held={[true, false, false, false, false]}
        releaseRequestId={null}
        request={null}
        onRollComplete={vi.fn()}
      />,
    )

    expect(screen.getByRole('img', { name: '주사위 2, 킵됨' })).toBeVisible()
    expect(screen.getByRole('img', { name: '주사위 6' })).toBeVisible()
  })

  it('대체 화면으로 내려온 사유가 있으면 함께 알린다', () => {
    const { rerender } = render(
      <PhysicsDiceFallback
        dice={null}
        held={request.held}
        releaseRequestId={null}
        request={null}
        onRollComplete={vi.fn()}
      />,
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    rerender(
      <PhysicsDiceFallback
        dice={null}
        held={request.held}
        message="3D 엔진을 사용할 수 없어요."
        releaseRequestId={null}
        request={null}
        onRollComplete={vi.fn()}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('3D 엔진을 사용할 수 없어요.')
  })

  it('KEEP을 누르면 그 자리 번호를 알린다', async () => {
    const onHeldToggle = vi.fn()
    const user = userEvent.setup()
    render(
      <PhysicsDiceFallback
        dice={[1, 2, 3, 4, 5]}
        held={[false, true, false, false, false]}
        onHeldToggle={onHeldToggle}
        releaseRequestId={null}
        request={null}
        onRollComplete={vi.fn()}
      />,
    )

    const keep = screen.getByRole('button', { name: '1 주사위 KEEP' })
    const release = screen.getByRole('button', { name: '2 주사위 KEEP 해제' })
    expect(keep).toHaveAttribute('aria-pressed', 'false')
    expect(release).toHaveAttribute('aria-pressed', 'true')

    await user.click(keep)
    expect(onHeldToggle).toHaveBeenCalledWith(0)
  })

  it('굴리는 중에는 KEEP을 바꿀 수 없다', () => {
    render(
      <PhysicsDiceFallback
        dice={null}
        held={request.held}
        onHeldToggle={vi.fn()}
        releaseRequestId={null}
        request={request}
        onRollComplete={vi.fn()}
      />,
    )

    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  })

  it('KEEP 핸들러가 없으면 주사위를 누를 수 없다', () => {
    render(
      <PhysicsDiceFallback
        dice={null}
        held={request.held}
        releaseRequestId={null}
        request={null}
        onRollComplete={vi.fn()}
      />,
    )

    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  })

  it('release가 오면 서버가 정한 결과 값으로 갈아탄다', () => {
    render(
      <PhysicsDiceFallback
        dice={[1, 1, 1, 1, 1]}
        held={request.held}
        releaseRequestId={request.requestId}
        request={request}
        onRollComplete={vi.fn()}
      />,
    )

    expect(screen.getByRole('img', { name: '주사위 6' })).toBeVisible()
    expect(screen.queryByRole('img', { name: '주사위 1' })).not.toBeInTheDocument()
  })
})
