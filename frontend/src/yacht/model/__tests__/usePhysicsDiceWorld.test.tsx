import { act, render, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installMatchMedia } from '@/test/mediaQuery'
import { type PhysicsDiceSceneProps, usePhysicsDiceWorld } from '@/yacht/model/usePhysicsDiceWorld'
import type { PhysicsDiceRollRequest } from '@/yacht/rendering/physics-dice/types'
import { worldControl } from './physicsDiceWorldDouble'

vi.mock(
  '@/yacht/rendering/physics-dice/loadWorld',
  () => import('@/yacht/model/__tests__/physicsDiceWorldDouble'),
)

const NONE_HELD = [false, false, false, false, false] as const
const REQUEST: PhysicsDiceRollRequest = {
  held: [...NONE_HELD],
  requestId: 'roll-1',
  seed: 7,
  targetDice: [1, 2, 3, 4, 5],
}

const props = (overrides: Partial<PhysicsDiceSceneProps> = {}): PhysicsDiceSceneProps => ({
  dice: null,
  held: [...NONE_HELD],
  onRollComplete: vi.fn(),
  releaseRequestId: null,
  request: null,
  ...overrides,
})

/**
 * 컨테이너가 실제로 붙은 화면 한 장. 훅은 ref가 채워진 뒤에야 월드를 세우므로
 * `renderHook`만으로는 적재 경로에 닿지 않는다.
 */
function mountScene(initial: Partial<PhysicsDiceSceneProps> = {}) {
  let latest: ReturnType<typeof usePhysicsDiceWorld> | null = null
  const Scene = (overrides: Partial<PhysicsDiceSceneProps>) => {
    const view = usePhysicsDiceWorld(props(overrides))
    latest = view
    return <div ref={view.containerRef} />
  }
  const view = render(<Scene {...initial} />)
  return {
    ...view,
    show: (overrides: Partial<PhysicsDiceSceneProps>) => view.rerender(<Scene {...overrides} />),
    view: () => {
      if (!latest) throw new Error('훅이 아직 돌지 않았다')
      return latest
    },
  }
}

beforeEach(() => {
  worldControl.reset()
  installMatchMedia(false)
})

afterEach(() => vi.clearAllMocks())

describe('usePhysicsDiceWorld 적재', () => {
  it('컨테이너가 붙기 전에는 월드를 세우지 않는다', () => {
    renderHook(() => usePhysicsDiceWorld(props()))

    expect(worldControl.instances).toHaveLength(0)
  })

  it('움직임을 줄이라고 했으면 3D를 아예 켜지 않고 대체 화면으로 알린다', async () => {
    installMatchMedia(true)
    const scene = mountScene()

    await waitFor(() => expect(scene.view().fallbackMessage).toContain('모션 감소'))
    expect(worldControl.instances).toHaveLength(0)
  })

  it('월드가 서면 지금 상태를 그대로 실어 보내고 기다림을 푼다', async () => {
    const scene = mountScene({
      dice: [6, 6, 6, 6, 6],
      keepAll: true,
      motionFollow: true,
      quality: 'high',
      releaseRequestId: REQUEST.requestId,
      request: REQUEST,
    })

    await waitFor(() => expect(scene.view().loading).toBe(false))
    expect(worldControl.last().calls).toEqual([
      'quality:high',
      'follow:true',
      'keepAll:true',
      'sync:66666:0',
      'start:roll-1',
      'pour',
      // 월드가 선 뒤 첫 렌더의 동기화가 한 번 더 따라온다.
      'sync:66666:0',
    ])
  })

  it('적재가 실패하면 대체 화면으로 내려가고 사유를 알린다', async () => {
    worldControl.loadFailure = new Error('WebGL 없음')
    const onError = vi.fn()

    const scene = mountScene({ onError: onError })

    await waitFor(() => expect(scene.view().fallbackMessage).toContain('3D 엔진'))
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'WebGL 없음' }))
  })

  it('Error가 아닌 것으로 실패해도 사유를 만들어 알린다', async () => {
    worldControl.loadFailure = '알 수 없음'
    const onError = vi.fn()

    mountScene({ onError: onError })

    await waitFor(() => expect(onError).toHaveBeenCalled())
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error)
  })

  it('세우는 도중에 화면이 사라지면 월드를 잡아 두지 않는다', async () => {
    const release = worldControl.hold()
    const scene = mountScene()

    // 적재는 끝나고 `init`을 기다리는 자리까지 진행시킨 뒤 떠난다.
    await act(async () => {
      await Promise.resolve()
    })
    expect(worldControl.instances).toHaveLength(1)

    scene.unmount()
    await act(async () => {
      release()
      await Promise.resolve()
    })

    expect(worldControl.last().destroyed).toBe(true)
    expect(scene.view().loading).toBe(true)
  })

  it('적재가 끝나기 전에 화면이 사라지면 실패도 삼킨다', async () => {
    worldControl.loadFailure = new Error('늦게 실패')
    const onError = vi.fn()
    const scene = mountScene({ onError: onError })

    scene.unmount()
    await act(async () => {
      await Promise.resolve()
    })

    expect(onError).not.toHaveBeenCalled()
  })
})

describe('usePhysicsDiceWorld 갱신', () => {
  it('월드가 선 뒤의 변화는 그때그때 넘긴다', async () => {
    const scene = mountScene()
    await waitFor(() => expect(scene.view().loading).toBe(false))
    const world = worldControl.last()
    world.calls.length = 0

    scene.show({
      dice: [1, 1, 1, 1, 1],
      keepAll: true,
      motionFollow: false,
      motionPulse: { direction: 'left', id: 1, strength: 0.4 },
      quality: 'eco',
      releaseRequestId: REQUEST.requestId,
      request: REQUEST,
    })

    await waitFor(() => expect(world.calls).toContain('pour'))
    expect(world.calls).toEqual([
      'sync:11111:0',
      'start:roll-1',
      'keepAll:true',
      'pour',
      'quality:eco',
      'follow:false',
      'pulse:left:0.4',
    ])
  })

  it('같은 흔들림은 두 번 전하지 않는다', async () => {
    const pulse = { direction: 'right', id: 3, strength: 0.7 } as const
    const scene = mountScene({ motionPulse: pulse })
    await waitFor(() => expect(scene.view().loading).toBe(false))
    const world = worldControl.last()
    world.calls.length = 0

    scene.show({ motionPulse: { ...pulse } })

    expect(world.calls.filter((call) => call.startsWith('pulse:'))).toHaveLength(0)
  })

  it('월드가 알려 온 것을 호출부로 그대로 올린다', async () => {
    const onDiceImpact = vi.fn()
    const onHeldToggle = vi.fn()
    const onPhaseChange = vi.fn()
    const onRollComplete = vi.fn()
    const scene = mountScene({
      onDiceImpact: onDiceImpact,
      onHeldToggle: onHeldToggle,
      onPhaseChange: onPhaseChange,
      onRollComplete: onRollComplete,
    })
    await waitFor(() => expect(scene.view().loading).toBe(false))
    const { callbacks } = worldControl.last().options

    act(() => {
      callbacks.onDiceImpact?.(0, 0.8)
      callbacks.onHeldToggle?.(2)
      callbacks.onPhaseChange?.('shaking')
      callbacks.onResizeChange?.(true)
      callbacks.onRollComplete('roll-1', [1, 2, 3, 4, 5])
      // 같은 굴림의 완료가 두 번 와도 한 번만 올라간다.
      callbacks.onRollComplete('roll-1', [1, 2, 3, 4, 5])
    })

    expect(onDiceImpact).toHaveBeenCalledWith(0, 0.8)
    expect(onHeldToggle).toHaveBeenCalledWith(2)
    expect(onPhaseChange).toHaveBeenCalledWith('shaking')
    expect(onRollComplete).toHaveBeenCalledOnce()
    expect(scene.view().resizing).toBe(true)
  })
})
