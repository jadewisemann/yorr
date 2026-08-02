import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MotionAvailability, MotionGestureState } from '@/input/motionTypes'
import {
  createPlayingRoomSnapshot,
  creatorPlayer,
  creatorSession,
  participantPlayer,
} from '@/mocks/fixtures'
import { createRealtimeFixture } from '@/mocks/realtimeScenarios'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import type { PhysicsDiceRollRequest, PhysicsDiceSet } from '@/rendering/physics-dice/types'
import { type ConnectionStatus, useAppStore } from '@/store'
import { GamePlay } from './GamePlay'

/**
 * 데스크톱 레이아웃(1024px 이상)에서만 존재하는 조작 — 키보드 단축키, '모두 해제',
 * 상시 점수 패널, 헤더 요약 — 의 사용자 관찰 가능한 결과를 고정한다.
 */
const WIDE_QUERY = '(min-width: 1024px)'

const motion = vi.hoisted(() => ({
  availability: 'unsupported' as MotionAvailability,
  gestureState: 'idle' as MotionGestureState,
}))

vi.mock('@/input/useMotionRollInput', () => ({
  useMotionRollInput: () => ({
    availability: motion.availability,
    calibrated: true,
    canConfirmThrow: false,
    gestureState: motion.gestureState,
    inputMode:
      motion.availability === 'listening' || motion.availability === 'paused' ? 'motion' : 'tap',
    lastPulseDirection: null,
    noiseRms: 0,
    requestPermission: vi.fn(),
    resetGesture: vi.fn(),
    reversalCount: 0,
  }),
}))

vi.mock('@/components/PhysicsDiceScene', () => ({
  PhysicsDiceScene: ({
    onRollComplete,
    request,
  }: {
    onRollComplete: (requestId: string, dice: PhysicsDiceSet) => void
    request: PhysicsDiceRollRequest | null
  }) => (
    <div data-request={request?.requestId ?? ''} data-testid="dice-scene">
      {request && (
        <button onClick={() => onRollComplete(request.requestId, [6, 5, 4, 3, 2])} type="button">
          굴림 완료
        </button>
      )}
    </div>
  ),
}))

const { snapshot: _snapshot, ...session } = creatorSession

function renderWideGame(
  snapshot = createPlayingRoomSnapshot(Date.now() + 30_000),
  connectionStatus: ConnectionStatus = 'connected',
) {
  const client = createRealtimeFixture()
  useAppStore.setState({ connectionStatus, roomSnapshot: snapshot })
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

describe('GamePlay 데스크톱 레이아웃', () => {
  beforeEach(() => {
    motion.availability = 'unsupported'
    motion.gestureState = 'idle'
    useAppStore.getState().reset()
    window.matchMedia = ((query: string) =>
      ({
        matches: query === WIDE_QUERY,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList) as typeof window.matchMedia
  })

  it('점수표를 시트 대신 상시 패널로 두고 굴리기 CTA에 단축키를 병기한다', () => {
    renderWideGame()

    expect(screen.getByRole('region', { name: '점수 시트' })).toBeVisible()
    expect(screen.getByRole('button', { name: /^굴리기/ })).toHaveTextContent('Space')
    // 시트를 여닫는 토글은 모바일 전용이다 — 넓은 화면엔 접을 것이 없다.
    expect(screen.queryByRole('button', { name: /접기|펼치기/ })).not.toBeInTheDocument()
  })

  it('Space로 굴리고 숫자 키로 킵을 잡는다', async () => {
    const { user } = renderWideGame()

    await user.keyboard(' ')
    expect(screen.getByTestId('dice-scene')).toHaveAttribute(
      'data-request',
      'roll-player-creator-1-1',
    )

    await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    await user.keyboard('1')

    expect(screen.getByText(/킵 레일 · 1\/5 · 합 6/)).toBeVisible()
  })

  it('포커스가 버튼에 있으면 단축키가 키 입력을 가로채지 않는다', async () => {
    const { user } = renderWideGame()

    await user.keyboard(' ')
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    screen.getByRole('button', { name: /^굴리기/ }).focus()
    await user.keyboard('1')

    // 버튼·입력에 포커스가 있으면 그 요소의 키 처리가 우선이다.
    expect(screen.getByText('킵 레일 · 비어 있음')).toBeVisible()
  })

  it("'모두 해제'는 킵을 한 번에 비우고 서버에는 결과만 한 번 알린다", async () => {
    const { client, user } = renderWideGame()

    await user.keyboard(' ')
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    expect(screen.getByRole('button', { name: '모두 해제' })).toBeDisabled()

    await user.keyboard('123')
    expect(screen.getByText(/킵 레일 · 3\/5 · 합 15/)).toBeVisible()

    await user.click(screen.getByRole('button', { name: '모두 해제' }))

    expect(screen.getByText('킵 레일 · 비어 있음')).toBeVisible()
    const holds = client.sentMessages.filter((message) => message.type === 'dice.hold')
    expect(holds).toHaveLength(1)
    expect(holds[0]?.payload).toEqual({
      held: [false, false, false, false, false],
      roundNumber: 1,
    })
  })

  it('헤더가 선두 플레이어와 연결 상태를 함께 알린다', () => {
    const snapshot = createPlayingRoomSnapshot(Date.now() + 30_000)
    const scores = snapshot.game?.scores
    if (!scores) throw new Error('playing snapshot is missing game scores')
    const creatorBoard = scores[creatorPlayer.playerId]
    const participantBoard = scores[participantPlayer.playerId]
    if (!creatorBoard || !participantBoard)
      throw new Error('playing snapshot is missing scoreboards')
    scores[creatorPlayer.playerId] = { ...creatorBoard, total: 40 }
    scores[participantPlayer.playerId] = { ...participantBoard, total: 120 }

    renderWideGame(snapshot)

    expect(screen.getByText('선두')).toBeVisible()
    expect(screen.getByText(`${participantPlayer.nickname} · 120`)).toBeVisible()
    expect(screen.getByText('연결됨')).toBeVisible()
  })

  it('연결이 흔들리면 헤더 상태와 조작 잠금이 함께 움직인다', () => {
    renderWideGame(createPlayingRoomSnapshot(Date.now() + 30_000), 'reconnecting')

    expect(screen.getByText('재연결 중')).toBeVisible()
    // 서버 상태와 어긋난 굴림이 가장 위험하다 — 재연결 중에는 CTA를 잠근다.
    expect(screen.getByRole('button', { name: /^굴리기/ })).toBeDisabled()
  })
})
