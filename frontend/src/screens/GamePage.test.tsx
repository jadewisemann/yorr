import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MotionGestureEvent } from '@/input/motionTypes'
import { creatorSession, participantSession, playingRoomSnapshot } from '@/mocks/fixtures'
import type { PhysicsDiceSet } from '@/rendering/physics-dice/types'
import { useAppStore } from '@/store'
import { GamePage } from './GamePage'

interface DiceSceneProps {
  dice: PhysicsDiceSet | null
  onRollComplete(requestId: string, dice: PhysicsDiceSet): void
  releaseRequestId: string | null
  request: { requestId: string; targetDice: PhysicsDiceSet } | null
}

const mocks = vi.hoisted(() => ({
  gestureCallback: null as ((event: MotionGestureEvent) => void) | null,
  motionAvailability: 'unsupported',
  navigate: vi.fn(),
  requestPermission: vi.fn(),
  resetGesture: vi.fn(),
  sceneProps: null as DiceSceneProps | null,
}))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => mocks.navigate,
}))

vi.mock('@/input/useMotionRollInput', () => ({
  useMotionRollInput: (callback: (event: MotionGestureEvent) => void) => {
    mocks.gestureCallback = callback
    return {
      availability: mocks.motionAvailability,
      canConfirmThrow: false,
      gestureState: 'idle',
      inputMode: mocks.motionAvailability === 'listening' ? 'motion' : 'tap',
      lastPulseDirection: null,
      requestPermission: mocks.requestPermission,
      resetGesture: mocks.resetGesture,
      reversalCount: 0,
    }
  },
}))

vi.mock('@/components/PhysicsDiceScene', () => ({
  PhysicsDiceScene: (props: DiceSceneProps) => {
    mocks.sceneProps = props
    return (
      <div
        data-testid="dice-scene"
        data-dice={props.dice?.join(',') ?? ''}
        data-request={props.request?.requestId ?? ''}
        data-release={props.releaseRequestId ?? ''}
      />
    )
  },
}))

vi.mock('@/realtime/RealtimeClientContext', () => ({
  useRealtimeClient: () => ({
    onMessage: vi.fn(() => () => undefined),
    send: vi.fn(),
  }),
}))

describe('GamePage motion roll flow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.gestureCallback = null
    mocks.motionAvailability = 'unsupported'
    mocks.navigate.mockReset()
    mocks.requestPermission.mockReset()
    mocks.resetGesture.mockReset()
    mocks.sceneProps = null
    useAppStore.getState().reset()
    useAppStore.getState().setRoomSession({
      ...creatorSession,
      snapshot: playingRoomSnapshot,
    })
  })

  it('탭 굴림도 준비 후 같은 release 계약을 사용한다', () => {
    render(<GamePage roomId={creatorSession.roomId} />)
    fireEvent.click(screen.getByRole('button', { name: '굴리기' }))

    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-request', 'r1-1')
    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-release', '')

    act(() => vi.advanceTimersByTime(600))
    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-release', 'r1-1')
  })

  it('흔들기 뒤 던지기 이벤트가 와야 센서 굴림을 release한다', () => {
    mocks.motionAvailability = 'listening'
    render(<GamePage roomId={creatorSession.roomId} />)

    act(() => {
      mocks.gestureCallback?.({ type: 'shakeStarted', at: 1_000 })
    })
    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-request', 'r1-1')
    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-release', '')

    act(() => {
      mocks.gestureCallback?.({ type: 'throwDetected', at: 1_300, confidence: 0.9 })
    })
    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-release', 'r1-1')
  })

  it('센서 굴림이 시작되면 인식 상태와 무관하게 확정 버튼으로 완주할 수 있다', () => {
    mocks.motionAvailability = 'listening'
    render(<GamePage roomId={creatorSession.roomId} />)

    act(() => {
      mocks.gestureCallback?.({ type: 'shakeStarted', at: 1_000 })
    })
    fireEvent.click(screen.getByRole('button', { name: '지금 던지기' }))

    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-release', 'r1-1')
  })

  it('브라우저와 관계없이 센서 시작 버튼에서 권한 요청을 시작한다', () => {
    mocks.motionAvailability = 'permissionRequired'
    render(<GamePage roomId={creatorSession.roomId} />)

    expect(screen.getByText('모션 센서를 사용해 볼까요?')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '센서 사용 시작하기' }))

    expect(mocks.requestPermission).toHaveBeenCalledOnce()
  })

  it('내 턴이 아니면 주사위 입력을 잠그고 현재 플레이어를 안내한다', () => {
    useAppStore.getState().setRoomSession({
      ...participantSession,
      snapshot: playingRoomSnapshot,
    })

    render(<GamePage roomId={participantSession.roomId} />)

    expect(
      screen.getByText(`${playingRoomSnapshot.players[0]?.nickname}님의 턴입니다`),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: '굴리기' })).not.toBeInTheDocument()
  })
})
