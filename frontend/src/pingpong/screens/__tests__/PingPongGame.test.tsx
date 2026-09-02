import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { playingSnapshot, playingState } from '@/pingpong/__tests__/pingPongFixtures'
import { PingPongGame } from '@/pingpong/screens/PingPongGame'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import type { RealtimeClient } from '@/realtime/realtimeClient'
import type { ActiveRoomSession } from '@/store'

vi.mock('@/pingpong/rendering/scene3d', () => ({
  createScene: () => ({ dispose: vi.fn(), render: vi.fn(), resize: vi.fn(), update: vi.fn() }),
}))

const state = playingState()

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
        snapshot={playingSnapshot(game)}
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

  it('데스크톱 워밍업에서 준비 완료를 보낼 수 있다', async () => {
    useDesktopViewport()
    const user = userEvent.setup()
    const client = renderGame({ ...state, phase: 'PREPARING', readyPlayerIds: [] })

    expect(screen.getByText('스페이스바로 연습 공을 쳐보세요')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '준비 완료' }))

    expect(client.send).toHaveBeenCalledOnce()
  })
})
