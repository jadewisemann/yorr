import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PhysicsDiceRollRequest,
  PhysicsDiceWorldCallbacks,
} from '@/rendering/physics-dice/types'
import { PhysicsDiceScene } from './PhysicsDiceScene'

type MockWorld = {
  applyQuality: ReturnType<typeof vi.fn>
  callbacks: PhysicsDiceWorldCallbacks
  destroy: ReturnType<typeof vi.fn>
  pour: ReturnType<typeof vi.fn>
  startRoll: ReturnType<typeof vi.fn>
}

const { initState, worlds } = vi.hoisted(() => ({
  initState: { promise: null as Promise<void> | null },
  worlds: [] as MockWorld[],
}))

vi.mock('@/rendering/physics-dice/World', () => ({
  PhysicsDiceWorld: class {
    callbacks: PhysicsDiceWorldCallbacks
    destroy = vi.fn()
    pour = vi.fn()
    startRoll = vi.fn()

    constructor({ callbacks }: { callbacks: PhysicsDiceWorldCallbacks }) {
      this.callbacks = callbacks
      worlds.push(this)
    }

    init = vi.fn(() => initState.promise ?? Promise.resolve())
    syncCommittedDice = vi.fn()
    applyQuality = vi.fn()
  },
}))

const request: PhysicsDiceRollRequest = {
  requestId: 'roll-73',
  seed: 73,
  held: [false, false, false, false, false],
}
const rolledDice = [6, 5, 4, 3, 2] as const

describe('PhysicsDiceScene', () => {
  beforeEach(() => {
    initState.promise = null
    worlds.length = 0
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    )
  })

  it('동일 request를 한 번만 시작하고 완료 callback도 중복 제거한다', async () => {
    const onRollComplete = vi.fn()
    const view = render(
      <PhysicsDiceScene
        dice={null}
        held={request.held}
        releaseRequestId={null}
        request={request}
        onRollComplete={onRollComplete}
      />,
    )

    await waitFor(() => expect(worlds).toHaveLength(1))
    await waitFor(() => expect(worlds[0]?.startRoll).toHaveBeenCalledOnce())

    view.rerender(
      <PhysicsDiceScene
        dice={null}
        held={request.held}
        releaseRequestId={request.requestId}
        request={request}
        onRollComplete={onRollComplete}
      />,
    )
    expect(worlds[0]?.startRoll).toHaveBeenCalledOnce()
    expect(worlds[0]?.pour).toHaveBeenCalledOnce()

    act(() => {
      worlds[0]?.callbacks.onRollComplete(request.requestId, rolledDice)
      worlds[0]?.callbacks.onRollComplete(request.requestId, rolledDice)
    })
    expect(onRollComplete).toHaveBeenCalledOnce()
    expect(onRollComplete).toHaveBeenCalledWith(request.requestId, rolledDice)

    view.unmount()
    expect(worlds[0]?.destroy).toHaveBeenCalledOnce()
  })

  it('3D 화면에서도 키보드로 주사위 값을 확인하고 KEEP을 바꾼다', async () => {
    const onHeldToggle = vi.fn()
    render(
      <PhysicsDiceScene
        dice={[6, 5, 4, 3, 2]}
        held={[false, true, false, false, false]}
        releaseRequestId={null}
        request={null}
        onHeldToggle={onHeldToggle}
        onRollComplete={vi.fn()}
      />,
    )

    await waitFor(() => expect(worlds).toHaveLength(1))
    const firstDie = screen.getByRole('button', { name: '1번 주사위, 6, KEEP' })
    const secondDie = screen.getByRole('button', { name: '2번 주사위, 5, KEEP 해제' })
    expect(firstDie).toHaveAttribute('aria-pressed', 'false')
    expect(secondDie).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(firstDie)
    expect(onHeldToggle).toHaveBeenCalledWith(0)
  })

  it('엔진 초기화가 끝난 뒤 최신 roll과 release를 처리한다', async () => {
    let resolveInit: (() => void) | undefined
    initState.promise = new Promise<void>((resolve) => {
      resolveInit = resolve
    })
    const view = render(
      <PhysicsDiceScene
        dice={null}
        held={request.held}
        releaseRequestId={null}
        request={null}
        onRollComplete={vi.fn()}
      />,
    )
    await waitFor(() => expect(worlds).toHaveLength(1))

    view.rerender(
      <PhysicsDiceScene
        dice={null}
        held={request.held}
        quality="high"
        releaseRequestId={request.requestId}
        request={request}
        onRollComplete={vi.fn()}
      />,
    )
    expect(worlds[0]?.startRoll).not.toHaveBeenCalled()
    expect(worlds[0]?.pour).not.toHaveBeenCalled()

    resolveInit?.()

    await waitFor(() => expect(worlds[0]?.startRoll).toHaveBeenCalledOnce())
    expect(worlds[0]?.applyQuality).toHaveBeenCalledWith('high')
    expect(worlds[0]?.pour).toHaveBeenCalledOnce()
  })
})
