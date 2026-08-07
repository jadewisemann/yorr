import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PhysicsDiceScene } from '@/yacht/components/PhysicsDiceScene'
import type {
  PhysicsDiceMotionPulse,
  PhysicsDiceRollRequest,
  PhysicsDiceWorldCallbacks,
} from '@/yacht/rendering/physics-dice/types'

type MockWorld = {
  applyQuality: ReturnType<typeof vi.fn>
  applyShakePulse: ReturnType<typeof vi.fn>
  callbacks: PhysicsDiceWorldCallbacks
  destroy: ReturnType<typeof vi.fn>
  pour: ReturnType<typeof vi.fn>
  setKeepAll: ReturnType<typeof vi.fn>
  setMotionFollow: ReturnType<typeof vi.fn>
  startRoll: ReturnType<typeof vi.fn>
  syncCommittedDice: ReturnType<typeof vi.fn>
}

const { initState, worlds } = vi.hoisted(() => ({
  initState: { promise: null as Promise<void> | null },
  worlds: [] as MockWorld[],
}))

vi.mock('@/yacht/rendering/physics-dice/World', () => ({
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
    setKeepAll = vi.fn()
    applyQuality = vi.fn()
    setMotionFollow = vi.fn()
    applyShakePulse = vi.fn()
  },
}))

const request: PhysicsDiceRollRequest = {
  requestId: 'roll-73',
  seed: 73,
  held: [false, false, false, false, false],
  targetDice: [6, 5, 4, 3, 2],
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
    expect(screen.getByRole('status')).toHaveTextContent('3D 주사위 준비 중')

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
    expect(screen.queryByText('3D 주사위 준비 중')).not.toBeInTheDocument()
    expect(worlds[0]?.applyQuality).toHaveBeenCalledWith('high')
    expect(worlds[0]?.pour).toHaveBeenCalledOnce()
  })

  it('엔진을 준비하는 동안 트레이 안에 로딩 상태를 표시한다', async () => {
    let resolveInit: (() => void) | undefined
    initState.promise = new Promise<void>((resolve) => {
      resolveInit = resolve
    })

    render(
      <PhysicsDiceScene
        dice={null}
        held={request.held}
        releaseRequestId={null}
        request={null}
        onRollComplete={vi.fn()}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('3D 주사위 준비 중')
    resolveInit?.()
    await waitFor(() => expect(screen.queryByText('3D 주사위 준비 중')).not.toBeInTheDocument())
  })

  it('엔진이 준비된 뒤 도착한 굴림도 한 번만 시작한다', async () => {
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
    await waitFor(() => expect(worlds[0]?.syncCommittedDice).toHaveBeenCalled())
    expect(worlds[0]?.startRoll).not.toHaveBeenCalled()

    view.rerender(
      <PhysicsDiceScene
        dice={null}
        held={request.held}
        releaseRequestId={null}
        request={request}
        onRollComplete={vi.fn()}
      />,
    )
    expect(worlds[0]?.startRoll).toHaveBeenCalledWith(request)

    // 같은 굴림이 새 객체로 다시 들어와도 사발을 두 번 흔들지 않는다.
    view.rerender(
      <PhysicsDiceScene
        dice={null}
        held={request.held}
        releaseRequestId={null}
        request={{ ...request }}
        onRollComplete={vi.fn()}
      />,
    )
    expect(worlds[0]?.startRoll).toHaveBeenCalledOnce()
  })

  it('다섯 개를 모두 킵 레일에 올리는 규칙을 주사위 배치보다 먼저 전달한다', async () => {
    const view = render(
      <PhysicsDiceScene
        dice={null}
        held={request.held}
        keepAll={false}
        releaseRequestId={null}
        request={null}
        onRollComplete={vi.fn()}
      />,
    )
    await waitFor(() => expect(worlds).toHaveLength(1))
    const world = worlds[0]
    if (!world) throw new Error('씬이 월드를 만들지 못했다')

    // 순서가 뒤집히면 초기 배치가 한 번 잘못 눕고 나서 고쳐진다.
    await waitFor(() => expect(world.syncCommittedDice).toHaveBeenCalled())
    expect(world.setKeepAll).toHaveBeenCalledWith(false)
    expect(world.setKeepAll.mock.invocationCallOrder[0]).toBeLessThan(
      Number(world.syncCommittedDice.mock.invocationCallOrder[0]),
    )

    view.rerender(
      <PhysicsDiceScene
        dice={null}
        held={request.held}
        keepAll
        releaseRequestId={null}
        request={null}
        onRollComplete={vi.fn()}
      />,
    )
    expect(world.setKeepAll).toHaveBeenLastCalledWith(true)
  })

  it('엔진의 상태 변화를 부모 callback으로 그대로 넘긴다', async () => {
    const onError = vi.fn()
    const onHeldToggle = vi.fn()
    const onPhaseChange = vi.fn()
    render(
      <PhysicsDiceScene
        dice={null}
        held={request.held}
        releaseRequestId={null}
        request={null}
        onError={onError}
        onHeldToggle={onHeldToggle}
        onPhaseChange={onPhaseChange}
        onRollComplete={vi.fn()}
      />,
    )
    await waitFor(() => expect(worlds).toHaveLength(1))
    const world = worlds[0]
    if (!world) return

    const failure = new Error('물리 스텝 실패')
    act(() => {
      world.callbacks.onError(failure)
      world.callbacks.onHeldToggle(2)
      world.callbacks.onPhaseChange('pouring')
    })

    expect(onError).toHaveBeenCalledWith(failure)
    expect(onHeldToggle).toHaveBeenCalledWith(2)
    expect(onPhaseChange).toHaveBeenCalledWith('pouring')
  })

  // 리사이즈 중에는 화면이 잠깐 비어 보인다 — 왜 멈춘 것처럼 보이는지 알려야 한다.
  it('엔진이 리사이즈 중이면 그 사실을 알린다', async () => {
    render(
      <PhysicsDiceScene
        dice={null}
        held={request.held}
        releaseRequestId={null}
        request={null}
        onRollComplete={vi.fn()}
      />,
    )
    await waitFor(() => expect(worlds).toHaveLength(1))
    const world = worlds[0]
    if (!world) return

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => world.callbacks.onResizeChange(true))
    expect(screen.getByRole('status')).toHaveTextContent('3D 화면 크기를 조정하고 있어요.')

    act(() => world.callbacks.onResizeChange(false))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('확정된 주사위와 KEEP 상태가 바뀌면 엔진에 동기화한다', async () => {
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
    await waitFor(() => expect(worlds[0]?.syncCommittedDice).toHaveBeenCalled())

    const held = [true, false, false, false, false] as const
    view.rerender(
      <PhysicsDiceScene
        dice={rolledDice}
        held={held}
        releaseRequestId={null}
        request={null}
        onRollComplete={vi.fn()}
      />,
    )
    expect(worlds[0]?.syncCommittedDice).toHaveBeenLastCalledWith(rolledDice, held)
  })

  it('모션 추종 여부와 흔들림 펄스를 엔진에 전달한다', async () => {
    const view = render(
      <PhysicsDiceScene
        dice={null}
        held={request.held}
        motionFollow={false}
        motionPulse={null}
        releaseRequestId={null}
        request={null}
        onRollComplete={vi.fn()}
      />,
    )
    await waitFor(() => expect(worlds).toHaveLength(1))
    await waitFor(() => expect(worlds[0]?.setMotionFollow).toHaveBeenCalledWith(false))

    const pulse: PhysicsDiceMotionPulse = { id: 1, direction: 'left', strength: 0.8 }
    view.rerender(
      <PhysicsDiceScene
        dice={null}
        held={request.held}
        motionFollow
        motionPulse={pulse}
        releaseRequestId={null}
        request={null}
        onRollComplete={vi.fn()}
      />,
    )
    expect(worlds[0]?.setMotionFollow).toHaveBeenLastCalledWith(true)
    expect(worlds[0]?.applyShakePulse).toHaveBeenCalledWith('left', 0.8)

    // 같은 펄스가 다시 들어와도 흔들림을 두 번 주지 않는다.
    view.rerender(
      <PhysicsDiceScene
        dice={null}
        held={request.held}
        motionFollow
        motionPulse={{ ...pulse }}
        releaseRequestId={null}
        request={null}
        onRollComplete={vi.fn()}
      />,
    )
    expect(worlds[0]?.applyShakePulse).toHaveBeenCalledOnce()
  })

  // 모션 감소 설정은 3D 사발 자체가 문제이므로 엔진을 아예 띄우지 않는다.
  it('모션 감소 설정이면 3D 엔진 없이 2D 화면으로 간다', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    )

    render(
      <PhysicsDiceScene
        dice={null}
        held={request.held}
        releaseRequestId={null}
        request={null}
        onRollComplete={vi.fn()}
      />,
    )

    expect(
      await screen.findByText('모션 감소 설정에 따라 간단한 주사위 화면을 사용합니다.'),
    ).toBeVisible()
    expect(screen.getByRole('region', { name: '2D 주사위 대체 화면' })).toBeVisible()
    expect(worlds).toHaveLength(0)
  })

  it('엔진 초기화가 실패하면 2D 화면으로 내려가고 오류를 알린다', async () => {
    const onError = vi.fn()
    const onHeldToggle = vi.fn()
    const failure = new Error('rapier wasm 로드 실패')
    initState.promise = Promise.reject(failure)

    render(
      <PhysicsDiceScene
        dice={null}
        held={request.held}
        releaseRequestId={null}
        request={null}
        onError={onError}
        onHeldToggle={onHeldToggle}
        onRollComplete={vi.fn()}
      />,
    )

    expect(
      await screen.findByText('3D 엔진을 사용할 수 없어 간단한 주사위 화면으로 전환했습니다.'),
    ).toBeVisible()
    expect(onError).toHaveBeenCalledWith(failure)
    // 반쯤 만들어진 엔진을 남겨 두면 WebGL 컨텍스트가 새어 나간다.
    expect(worlds[0]?.destroy).toHaveBeenCalled()
    // 2D 화면에서도 KEEP은 계속 눌러야 한다.
    expect(screen.getAllByRole('button')[0]).toBeEnabled()
  })
})
