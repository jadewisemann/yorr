import { act, type RenderResult, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
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

type SceneProps = ComponentProps<typeof PhysicsDiceScene>

/** 기본값은 "아직 굴리지 않은 장면"이다. 검사마다 달라지는 것만 덮어쓴다. */
const sceneProps = (overrides: Partial<SceneProps> = {}): SceneProps => ({
  dice: null,
  held: request.held,
  releaseRequestId: null,
  request: null,
  onRollComplete: vi.fn(),
  ...overrides,
})

let lastView: RenderResult | null = null

function renderScene(overrides: Partial<SceneProps> = {}) {
  lastView = render(<PhysicsDiceScene {...sceneProps(overrides)} />)
  return lastView
}

/** 방금 그린 장면을 새 props로 다시 그린다 — 같은 월드를 이어 쓰는 것이 이 검사들의 전제다. */
function rerenderScene(overrides: Partial<SceneProps> = {}) {
  if (!lastView) throw new Error('아직 그려지지 않았다')
  lastView.rerender(<PhysicsDiceScene {...sceneProps(overrides)} />)
}

describe('PhysicsDiceScene', () => {
  beforeEach(() => {
    initState.promise = null
    worlds.length = 0
    lastView = null
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
    renderScene({ request: request, onRollComplete: onRollComplete })

    await waitFor(() => expect(worlds).toHaveLength(1))
    await waitFor(() => expect(worlds[0]?.startRoll).toHaveBeenCalledOnce())

    rerenderScene({
      releaseRequestId: request.requestId,

      request: request,

      onRollComplete: onRollComplete,
    })
    expect(worlds[0]?.startRoll).toHaveBeenCalledOnce()
    expect(worlds[0]?.pour).toHaveBeenCalledOnce()

    act(() => {
      worlds[0]?.callbacks.onRollComplete(request.requestId, rolledDice)
      worlds[0]?.callbacks.onRollComplete(request.requestId, rolledDice)
    })
    expect(onRollComplete).toHaveBeenCalledOnce()
    expect(onRollComplete).toHaveBeenCalledWith(request.requestId, rolledDice)

    lastView?.unmount()
    expect(worlds[0]?.destroy).toHaveBeenCalledOnce()
  })

  it('엔진 초기화가 끝난 뒤 최신 roll과 release를 처리한다', async () => {
    let resolveInit: (() => void) | undefined
    initState.promise = new Promise<void>((resolve) => {
      resolveInit = resolve
    })
    renderScene()
    await waitFor(() => expect(worlds).toHaveLength(1))
    expect(screen.getByRole('status')).toHaveTextContent('3D 주사위 준비 중')

    rerenderScene({ quality: 'high', releaseRequestId: request.requestId, request: request })
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

    renderScene()

    expect(screen.getByRole('status')).toHaveTextContent('3D 주사위 준비 중')
    resolveInit?.()
    await waitFor(() => expect(screen.queryByText('3D 주사위 준비 중')).not.toBeInTheDocument())
  })

  it('엔진이 준비된 뒤 도착한 굴림도 한 번만 시작한다', async () => {
    renderScene()
    await waitFor(() => expect(worlds).toHaveLength(1))
    await waitFor(() => expect(worlds[0]?.syncCommittedDice).toHaveBeenCalled())
    expect(worlds[0]?.startRoll).not.toHaveBeenCalled()

    rerenderScene({ request: request })
    expect(worlds[0]?.startRoll).toHaveBeenCalledWith(request)

    rerenderScene({ request: { ...request } })
    expect(worlds[0]?.startRoll).toHaveBeenCalledOnce()
  })

  it('다섯 개를 모두 킵 레일에 올리는 규칙을 주사위 배치보다 먼저 전달한다', async () => {
    renderScene({ keepAll: false })
    await waitFor(() => expect(worlds).toHaveLength(1))
    const world = worlds[0]
    if (!world) throw new Error('씬이 월드를 만들지 못했다')

    await waitFor(() => expect(world.syncCommittedDice).toHaveBeenCalled())
    expect(world.setKeepAll).toHaveBeenCalledWith(false)
    expect(world.setKeepAll.mock.invocationCallOrder[0]).toBeLessThan(
      Number(world.syncCommittedDice.mock.invocationCallOrder[0]),
    )

    rerenderScene({ keepAll: true })
    expect(world.setKeepAll).toHaveBeenLastCalledWith(true)
  })

  it('엔진의 상태 변화를 부모 callback으로 그대로 넘긴다', async () => {
    const onError = vi.fn()
    const onHeldToggle = vi.fn()
    const onPhaseChange = vi.fn()
    renderScene({ onError: onError, onHeldToggle: onHeldToggle, onPhaseChange: onPhaseChange })
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

  it('엔진이 리사이즈 중이면 그 사실을 알린다', async () => {
    renderScene()
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
    renderScene()
    await waitFor(() => expect(worlds).toHaveLength(1))
    await waitFor(() => expect(worlds[0]?.syncCommittedDice).toHaveBeenCalled())

    const held = [true, false, false, false, false] as const
    rerenderScene({ dice: rolledDice, held: held })
    expect(worlds[0]?.syncCommittedDice).toHaveBeenLastCalledWith(rolledDice, held)
  })

  it('모션 추종 여부와 흔들림 펄스를 엔진에 전달한다', async () => {
    renderScene({ motionFollow: false, motionPulse: null })
    await waitFor(() => expect(worlds).toHaveLength(1))
    await waitFor(() => expect(worlds[0]?.setMotionFollow).toHaveBeenCalledWith(false))

    const pulse: PhysicsDiceMotionPulse = { id: 1, direction: 'left', strength: 0.8 }
    rerenderScene({ motionFollow: true, motionPulse: pulse })
    expect(worlds[0]?.setMotionFollow).toHaveBeenLastCalledWith(true)
    expect(worlds[0]?.applyShakePulse).toHaveBeenCalledWith('left', 0.8)

    rerenderScene({ motionFollow: true, motionPulse: { ...pulse } })
    expect(worlds[0]?.applyShakePulse).toHaveBeenCalledOnce()
  })

  it('모션 감소 설정이면 3D 엔진 없이 2D 화면으로 간다', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    )

    renderScene()

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

    renderScene({ onError: onError, onHeldToggle: onHeldToggle })

    expect(
      await screen.findByText('3D 엔진을 사용할 수 없어 간단한 주사위 화면으로 전환했습니다.'),
    ).toBeVisible()
    expect(onError).toHaveBeenCalledWith(failure)
    expect(worlds[0]?.destroy).toHaveBeenCalled()
    expect(screen.getAllByRole('button')[0]).toBeEnabled()
  })
})
