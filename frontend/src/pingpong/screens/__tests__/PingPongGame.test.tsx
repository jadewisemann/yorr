import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitingRoomSnapshot } from '@/mocks/fixtures'
import { PingPongGame } from '@/pingpong/screens/PingPongGame'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import type { RealtimeClient } from '@/realtime/realtimeClient'
import type { PingPongState, RoomSnapshot } from '@/realtime/wsEvents'
import type { ActiveRoomSession } from '@/store'

// jsdom에는 WebGL이 없어 실제 씬은 만들어지지 않는다. 여기서 보는 것은 "어느 화면이 떴는가"라
// 씬은 조용한 대역으로 충분하다(3D 거동은 scene3d 자신의 테스트가 맡는다).
vi.mock('@/pingpong/rendering/scene3d', () => ({
  createScene: () => ({ dispose: vi.fn(), render: vi.fn(), resize: vi.fn(), update: vi.fn() }),
}))

const state: PingPongState = {
  ball: {
    direction: 1,
    fault: null,
    faultFrom: 0,
    launchedAt: 1_000,
    pos: 0.5,
    smash: false,
    speed: 1.95,
    x0: 0.5,
    x1: 0.7,
  },
  lastEvent: null,
  lastInputSeq: { 'player-1': 1, 'player-2': 1 },
  nextActionAt: 2_000,
  phase: 'PLAYING',
  playerOrder: ['player-1', 'player-2'],
  readyPlayerIds: ['player-1', 'player-2'],
  rally: 2,
  scores: { 'player-1': 3, 'player-2': 2 },
  serveReceiverId: 'player-1',
  version: 3,
}

function snapshotOf(game: PingPongState) {
  return {
    ...waitingRoomSnapshot,
    game,
    gameCode: 'PING_PONG',
    phase: 'playing',
    players: [
      { ...waitingRoomSnapshot.players[0], nickname: '나', playerId: 'player-1' },
      { ...waitingRoomSnapshot.players[1], nickname: '상대', playerId: 'player-2' },
    ],
  } as unknown as RoomSnapshot
}

const session = {
  gameId: null,
  membershipRole: 'participant',
  nickname: '나',
  roomCode: 'A4F2',
  roomId: 'room-1',
  sessionToken: 'session-64',
  snapshot: null,
  you: 'player-1',
} as unknown as ActiveRoomSession

/** 넓은 화면 + 마우스. 기본(matchMedia 미일치)은 손에 쥔 기기다. */
function useDesktopViewport() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

function renderGame(game = state) {
  const client = { send: vi.fn() } as unknown as RealtimeClient
  render(
    <RealtimeClientProvider client={client}>
      <PingPongGame
        onLeaveRequest={vi.fn()}
        roomId="room-1"
        session={session}
        snapshot={snapshotOf(game)}
      />
    </RealtimeClientProvider>,
  )
  return client
}

describe('PingPongGame 기기별 화면', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        disconnect() {}
        observe() {}
        unobserve() {}
      },
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  // 빠른 대전은 파티방과 같은 participant다 — 기기를 보지 않으면 데스크톱에도 폰 컨트롤러가 떴다.
  it('폰에서는 라켓 컨트롤러가 뜬다', () => {
    renderGame()

    expect(screen.getByText('PHONE CONTROLLER')).toBeVisible()
    expect(screen.queryByLabelText('3D 탁구 코트')).not.toBeInTheDocument()
  })

  it('데스크톱에서는 코트와 키보드 안내가 뜬다', () => {
    useDesktopViewport()
    renderGame()

    expect(screen.getByLabelText('3D 탁구 코트')).toBeInTheDocument()
    expect(screen.getByText('스페이스바 또는 화면 클릭으로 받아치기')).toBeVisible()
    expect(screen.queryByText('PHONE CONTROLLER')).not.toBeInTheDocument()
  })

  it('데스크톱 코트를 클릭하면 스윙을 보낸다', async () => {
    useDesktopViewport()
    const user = userEvent.setup()
    const client = renderGame()

    await user.click(screen.getByRole('button', { name: '화면을 클릭해 스윙' }))

    expect(client.send).toHaveBeenCalledOnce()
  })

  // 워밍업은 폰에만 있던 단계였다 — 데스크톱은 준비 완료를 누를 자리가 없어 경기가 시작되지 않았다.
  it('데스크톱 워밍업에서 준비 완료를 보낼 수 있다', async () => {
    useDesktopViewport()
    const user = userEvent.setup()
    const client = renderGame({ ...state, phase: 'PREPARING', readyPlayerIds: [] })

    expect(screen.getByText('스페이스바로 연습 공을 쳐보세요')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '준비 완료' }))

    expect(client.send).toHaveBeenCalledOnce()
  })
})
