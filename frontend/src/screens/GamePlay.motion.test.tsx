import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MotionAvailability, MotionGestureEvent } from '@/input/motionTypes'
import { createPlayingRoomSnapshot, creatorSession, serverMessage } from '@/mocks/fixtures'
import { createRealtimeFixture } from '@/mocks/realtimeScenarios'
import type { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import type { DiceSet } from '@/realtime/wsEvents'
import type { PhysicsDiceMotionPulse, PhysicsDiceRollRequest } from '@/rendering/physics-dice/types'
import { useAppStore } from '@/store'
import { GamePlay } from './GamePlay'

/**
 * 센서 굴림은 "흔들기 → 던지기" 두 신호가 서버 왕복과 섞이는 구간이라 순서가 어긋나기 쉽다.
 * 여기서는 센서 훅을 테스트가 직접 몰아 그 순서 계약과 촉각 피드백을 고정한다.
 */
const motion = vi.hoisted(() => ({
  availability: 'listening' as MotionAvailability,
  emit: null as ((event: MotionGestureEvent) => void) | null,
  requestPermission: vi.fn(),
  resetGesture: vi.fn(),
}))

vi.mock('@/input/useMotionRollInput', () => ({
  useMotionRollInput: (onGestureEvent: (event: MotionGestureEvent) => void) => {
    motion.emit = onGestureEvent
    return {
      availability: motion.availability,
      calibrated: true,
      canConfirmThrow: false,
      gestureState: 'idle',
      inputMode: motion.availability === 'listening' ? 'motion' : 'tap',
      lastPulseDirection: null,
      noiseRms: 0,
      requestPermission: motion.requestPermission,
      resetGesture: motion.resetGesture,
      reversalCount: 0,
    }
  },
}))

vi.mock('@/components/PhysicsDiceScene', () => ({
  PhysicsDiceScene: ({
    motionPulse,
    onError,
    onRollComplete,
    releaseRequestId,
    request,
  }: {
    motionPulse?: PhysicsDiceMotionPulse | null
    onError?: (error: Error) => void
    onRollComplete: (requestId: string, dice: DiceSet) => void
    releaseRequestId: string | null
    request: PhysicsDiceRollRequest | null
  }) => (
    <div
      data-pulse={motionPulse ? `${motionPulse.direction}:${motionPulse.strength}` : ''}
      data-release={releaseRequestId ?? ''}
      data-request={request?.requestId ?? ''}
      data-testid="dice-scene"
    >
      {request && (
        <button onClick={() => onRollComplete(request.requestId, [6, 6, 6, 6, 6])} type="button">
          굴림 완료
        </button>
      )}
      <button onClick={() => onError?.(new Error('webgl context lost'))} type="button">
        씬 오류
      </button>
    </div>
  ),
}))

const { snapshot: _snapshot, ...session } = creatorSession

/** 굴림 요청은 나가지만 서버 브로드캐스트는 테스트가 원하는 시점에 직접 넣는다. */
function withheldRoll(client: FakeRealtimeClient) {
  const send = client.send.bind(client)
  vi.spyOn(client, 'send').mockImplementation((message) => {
    if (message.type === 'dice.roll') {
      client.sentMessages.push(message)
      return
    }
    send(message)
  })
  return client
}

function broadcastRoll(client: FakeRealtimeClient, dice: DiceSet) {
  const roll = client.sentMessages.find((message) => message.type === 'dice.roll')
  act(() => {
    client.emitMessage(
      serverMessage(
        'dice.broadcast',
        {
          dice,
          held: [false, false, false, false, false],
          playerId: creatorSession.you,
          rollCount: 1,
          roundNumber: 1,
        },
        { roomId: creatorSession.roomId, msgId: roll?.msgId },
      ),
    )
  })
}

function renderGame(client: FakeRealtimeClient = createRealtimeFixture()) {
  const snapshot = createPlayingRoomSnapshot(Date.now() + 30_000)
  useAppStore.setState({ connectionStatus: 'connected', roomSnapshot: snapshot })
  return {
    ...render(
      <RealtimeClientProvider client={client}>
        <GamePlay
          onLeaveRequest={() => {}}
          roomId={session.roomId}
          session={session}
          snapshot={snapshot}
        />
      </RealtimeClientProvider>,
    ),
    client,
    user: userEvent.setup(),
  }
}

describe('GamePlay 센서 굴림', () => {
  let vibrate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    motion.availability = 'listening'
    motion.emit = null
    motion.requestPermission.mockReset()
    motion.resetGesture.mockReset()
    vibrate = vi.fn()
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate })
    useAppStore.getState().reset()
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(navigator, 'vibrate')
  })

  it('흔드는 동안 진동과 사발 흔들림으로 인식되고 있음을 알린다', () => {
    renderGame()

    act(() => {
      motion.emit?.({ type: 'shakePulse', at: 1_000, direction: 'left', strength: 0.5 })
    })

    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-pulse', 'left:0.5')
    expect(vibrate).toHaveBeenCalled()
  })

  it('던지기 동작이 굴림 응답보다 먼저 와도 주사위가 도착하는 순간 놓아 준다', () => {
    const { client } = renderGame(withheldRoll(createRealtimeFixture()))

    act(() => motion.emit?.({ type: 'shakeStarted', at: 1_000 }))
    // 아직 서버 주사위가 없어 놓을 대상이 없다 — 던지기를 예약해 둔다.
    act(() => motion.emit?.({ type: 'throwDetected', at: 1_200, confidence: 0.9 }))
    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-release', '')

    broadcastRoll(client, [6, 5, 4, 3, 2])

    // 예약을 잃으면 던지는 동작을 한 번 더 해야 굴림이 끝난다.
    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-release', 'r1-1')
  })

  it('버튼으로 굴린 굴림은 던지기 동작으로 앞당겨지지 않는다', () => {
    renderGame()

    fireEvent.click(screen.getByRole('button', { name: '굴리기' }))
    act(() => motion.emit?.({ type: 'throwDetected', at: 1_200, confidence: 0.9 }))

    // 탭 굴림은 정해진 연출 시간을 따른다 — 센서 신호가 끼어들면 두 연출이 겹친다.
    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-release', '')
  })

  it('흔들기 무장·취소 신호만으로는 굴림을 요청하지 않는다', () => {
    const { client } = renderGame()

    act(() => motion.emit?.({ type: 'shakeArmed', at: 1_000 }))
    act(() => motion.emit?.({ type: 'gestureCancelled', at: 1_100, reason: 'idle' }))

    expect(client.sentMessages.some((message) => message.type === 'dice.roll')).toBe(false)
    expect(screen.getByRole('button', { name: '굴리기' })).toBeEnabled()
  })

  it('센서를 쓸 수 없다는 안내는 닫으면 다시 시야를 가리지 않는다', async () => {
    motion.availability = 'denied'
    const { user } = renderGame()

    expect(screen.getByRole('region', { name: '센서 권한 안내' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '센서 안내 닫기' }))

    expect(screen.queryByRole('region', { name: '센서 권한 안내' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '굴리기' })).toBeEnabled()
  })

  it('물리 씬이 깨져도 굴리기는 계속 열려 있다', () => {
    renderGame()

    fireEvent.click(screen.getByRole('button', { name: '씬 오류' }))

    expect(vibrate).toHaveBeenCalledWith([35, 30, 35])
    expect(screen.getByRole('button', { name: '굴리기' })).toBeEnabled()
  })

  it('족보 연출은 스스로 사라져 다음 조작을 막지 않는다', () => {
    vi.useFakeTimers()
    const { client } = renderGame(withheldRoll(createRealtimeFixture()))
    // 마운트 시 뜨는 "내 차례!" 콜아웃과 Date.now() 기반 리마운트 key가 같은 밀리초로
    // 찍히지 않도록 살짝 시간을 흘려보낸다 — 안 그러면 두 콜아웃이 key 충돌을 일으킨다.
    act(() => vi.advanceTimersByTime(10))

    fireEvent.click(screen.getByRole('button', { name: '굴리기' }))
    broadcastRoll(client, [6, 6, 6, 6, 6])
    fireEvent.click(screen.getByRole('button', { name: '굴림 완료' }))
    expect(screen.getByText('요트!!!')).toBeVisible()

    act(() => vi.advanceTimersByTime(2_400))

    expect(screen.queryByText('요트!!!')).not.toBeInTheDocument()
  })
})
