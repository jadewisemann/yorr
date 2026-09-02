import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  creatorSession,
  participantSession,
  playingRoomSnapshot,
  waitingRoomSnapshot,
} from '@/mocks/fixtures'
import { GamePage } from '@/room/screens/GamePage'
import { useAppStore } from '@/store'
import { navigateSpy } from '@/test/routerDouble'
import type { MotionGestureEvent } from '@/yacht/input/motionTypes'
import type { PhysicsDiceSet } from '@/yacht/rendering/physics-dice/types'
import { hideTutorial } from '@/yacht/tutorialPreference'

interface DiceSceneProps {
  dice: PhysicsDiceSet | null
  onRollComplete(requestId: string, dice: PhysicsDiceSet): void
  releaseRequestId: string | null
  request: { requestId: string; targetDice: PhysicsDiceSet } | null
}

const mocks = vi.hoisted(() => ({
  gestureCallback: null as ((event: MotionGestureEvent) => void) | null,
  motionAvailability: 'unsupported',
  realtimeListeners: new Set<(message: never) => void>(),
  requestPermission: vi.fn(),
  resetGesture: vi.fn(),
  sceneProps: null as DiceSceneProps | null,
}))

vi.mock('@tanstack/react-router', async () =>
  (await import('@/test/routerDouble')).routerWithNavigateSpy(),
)

vi.mock('@/yacht/input/useMotionRollInput', () => ({
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

vi.mock('@/yacht/components/PhysicsDiceScene', () => ({
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
    onMessage: vi.fn((listener: (message: never) => void) => {
      mocks.realtimeListeners.add(listener)
      return () => mocks.realtimeListeners.delete(listener)
    }),
    send: vi.fn(
      (message: {
        msgId?: string
        payload: {
          held: readonly [boolean, boolean, boolean, boolean, boolean]
          rollCount: 1 | 2 | 3
          roundNumber: number
        }
        roomId?: string
        type: string
      }) => {
        if (message.type !== 'game.yacht_dice.dice.roll') return
        const broadcast = {
          type: 'game.yacht_dice.dice.broadcast',
          ts: Date.now(),
          roomId: message.roomId,
          msgId: message.msgId,
          payload: {
            playerId: 'player-creator',
            roundNumber: message.payload.roundNumber,
            rollCount: message.payload.rollCount,
            dice: [6, 5, 4, 3, 2],
            held: message.payload.held,
          },
        } as never
        mocks.realtimeListeners.forEach((listener) => {
          listener(broadcast)
        })
      },
    ),
  }),
}))

describe('GamePage motion roll flow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.gestureCallback = null
    mocks.motionAvailability = 'unsupported'
    navigateSpy.mockReset()
    mocks.realtimeListeners.clear()
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

    expect(screen.getByTestId('dice-scene')).toHaveAttribute(
      'data-request',
      'roll-player-creator-1-1',
    )
    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-release', '')

    act(() => vi.advanceTimersByTime(600))
    expect(screen.getByTestId('dice-scene')).toHaveAttribute(
      'data-release',
      'roll-player-creator-1-1',
    )
  })

  it('흔들기 뒤 던지기 이벤트가 와야 센서 굴림을 release한다', () => {
    mocks.motionAvailability = 'listening'
    render(<GamePage roomId={creatorSession.roomId} />)

    act(() => {
      mocks.gestureCallback?.({ type: 'shakeStarted', at: 1_000 })
    })
    expect(screen.getByTestId('dice-scene')).toHaveAttribute(
      'data-request',
      'roll-player-creator-1-1',
    )
    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-release', '')

    act(() => {
      mocks.gestureCallback?.({ type: 'throwDetected', at: 1_300, confidence: 0.9 })
    })
    expect(screen.getByTestId('dice-scene')).toHaveAttribute(
      'data-release',
      'roll-player-creator-1-1',
    )
  })

  it('센서 굴림이 시작되면 인식 상태와 무관하게 확정 버튼으로 완주할 수 있다', () => {
    mocks.motionAvailability = 'listening'
    render(<GamePage roomId={creatorSession.roomId} />)

    act(() => {
      mocks.gestureCallback?.({ type: 'shakeStarted', at: 1_000 })
    })
    fireEvent.click(screen.getByRole('button', { name: '지금 던지기' }))

    expect(screen.getByTestId('dice-scene')).toHaveAttribute(
      'data-release',
      'roll-player-creator-1-1',
    )
  })

  it('모션 센서 안내는 켤 수 있는 기기에서 코치마크를 닫는 즉시 뜬다', () => {
    mocks.motionAvailability = 'permissionRequired'
    render(<GamePage roomId={creatorSession.roomId} />)

    expect(screen.queryByText('모션 센서를 사용해 볼까요?')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '알겠어요' }))

    expect(screen.getByText('모션 센서를 사용해 볼까요?')).toBeVisible()
  })

  it('브라우저와 관계없이 센서 시작 버튼에서 권한 요청을 시작한다', () => {
    mocks.motionAvailability = 'permissionRequired'
    hideTutorial()
    render(<GamePage roomId={creatorSession.roomId} />)

    fireEvent.click(screen.getByRole('button', { name: '센서 사용 시작하기' }))

    expect(mocks.requestPermission).toHaveBeenCalledOnce()
  })

  it('내 턴이 아니면 주사위 입력을 잠그고 현재 플레이어를 안내한다', () => {
    useAppStore.getState().setRoomSession({
      ...participantSession,
      snapshot: playingRoomSnapshot,
    })

    render(<GamePage roomId={participantSession.roomId} />)

    const turnOrder = screen.getByRole('list', { name: '턴 순서' })
    expect(turnOrder).toHaveTextContent(String(playingRoomSnapshot.players[0]?.nickname))
    expect(screen.getByText(`${playingRoomSnapshot.players[0]?.nickname}의 턴`)).toBeVisible()
    expect(turnOrder).toHaveTextContent(participantSession.nickname)
    expect(screen.queryByRole('button', { name: '굴리기' })).not.toBeInTheDocument()
  })

  it('헤더의 나가기 버튼은 바로 나가지 않고 확인을 받는다', () => {
    render(<GamePage roomId={creatorSession.roomId} />)

    fireEvent.click(screen.getByRole('button', { name: '나가기' }))
    const dialog = screen.getByRole('alertdialog', { name: '방에서 나갈까요?' })
    expect(dialog).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: '머무르기' }))

    expect(screen.queryByRole('alertdialog', { name: '방에서 나갈까요?' })).not.toBeInTheDocument()
    expect(useAppStore.getState().roomSession).not.toBeNull()
    expect(screen.getByRole('button', { name: '굴리기' })).toBeVisible()
  })

  it('방이 대기 상태로 돌아가면 게임 화면에 머무르지 않고 대기실로 옮긴다', async () => {
    render(<GamePage roomId={creatorSession.roomId} />)
    navigateSpy.mockReset()

    await act(async () => {
      useAppStore.getState().replaceRoomSnapshot({ ...waitingRoomSnapshot })
    })

    expect(navigateSpy).toHaveBeenCalledWith({
      to: '/rooms/$roomId/lobby',
      params: { roomId: creatorSession.roomId },
      replace: true,
    })
  })
})
