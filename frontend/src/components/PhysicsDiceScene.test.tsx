import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PhysicsDiceRollRequest,
  PhysicsDiceWorldCallbacks,
} from '@/rendering/physics-dice/types'
import { PhysicsDiceScene } from './PhysicsDiceScene'

type MockWorld = {
  callbacks: PhysicsDiceWorldCallbacks
  destroy: ReturnType<typeof vi.fn>
  startRoll: ReturnType<typeof vi.fn>
}

const { worlds } = vi.hoisted(() => ({ worlds: [] as MockWorld[] }))

vi.mock('@/rendering/physics-dice/World', () => ({
  PhysicsDiceWorld: class {
    callbacks: PhysicsDiceWorldCallbacks
    destroy = vi.fn()
    startRoll = vi.fn()

    constructor({ callbacks }: { callbacks: PhysicsDiceWorldCallbacks }) {
      this.callbacks = callbacks
      worlds.push(this)
    }

    init = vi.fn().mockResolvedValue(undefined)
    syncCommittedDice = vi.fn()
    applyQuality = vi.fn()
  },
}))

const request: PhysicsDiceRollRequest = {
  requestId: 'roll-73',
  seed: 73,
  targetDice: [6, 5, 4, 3, 2],
  held: [false, false, false, false, false],
}

describe('PhysicsDiceScene', () => {
  beforeEach(() => {
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
        request={request}
        onRollComplete={onRollComplete}
      />,
    )
    expect(worlds[0]?.startRoll).toHaveBeenCalledOnce()

    act(() => {
      worlds[0]?.callbacks.onRollComplete(request.requestId, request.targetDice)
      worlds[0]?.callbacks.onRollComplete(request.requestId, request.targetDice)
    })
    expect(onRollComplete).toHaveBeenCalledOnce()
    expect(onRollComplete).toHaveBeenCalledWith(request.requestId, request.targetDice)

    view.unmount()
    expect(worlds[0]?.destroy).toHaveBeenCalledOnce()
  })
})
