import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DavinciGame } from '@/davinci/screens/DavinciGame'
import { waitingRoomSnapshot } from '@/mocks/fixtures'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import type { RealtimeClient } from '@/realtime/realtimeClient'
import type { DavinciTile, DavinciView, RoomSnapshot } from '@/realtime/wsEvents'
import type { ActiveRoomSession } from '@/store'

const ME = 'player-1'
const RIVAL = 'player-2'

const tile = (overrides: Partial<DavinciTile> = {}): DavinciTile => ({
  id: 'T0',
  color: 'BLACK',
  number: null,
  revealed: false,
  ...overrides,
})

const state: DavinciView = {
  deckCount: 14,
  eliminated: [],
  hands: {
    [ME]: [tile({ id: 'M0', number: 1 }), tile({ id: 'M1', color: 'WHITE', number: 9 })],
    [RIVAL]: [tile({ id: 'R0' }), tile({ id: 'R1', color: 'WHITE' })],
  },
  hits: {},
  lastInputSeq: {},
  nextActionAt: 0,
  phase: 'GUESSING',
  playerOrder: [ME, RIVAL],
  turn: 1,
  turnPlayerId: ME,
  version: 1,
}

const session = {
  gameId: null,
  membershipRole: 'participant',
  nickname: '나',
  roomCode: 'A4F2',
  roomId: 'room-1',
  sessionToken: 'session-64',
  snapshot: null,
  you: ME,
} as unknown as ActiveRoomSession

const snapshotOf = (game: DavinciView): RoomSnapshot =>
  ({
    ...waitingRoomSnapshot,
    game,
    gameCode: 'DAVINCI_CODE',
    phase: 'playing',
    players: [
      { ...waitingRoomSnapshot.players[0], nickname: '나', playerId: ME },
      { ...waitingRoomSnapshot.players[1], nickname: '상대', playerId: RIVAL },
    ],
  }) as unknown as RoomSnapshot

function renderGame(game: DavinciView = state) {
  const client = { send: vi.fn() } as unknown as RealtimeClient
  render(
    <RealtimeClientProvider client={client}>
      <DavinciGame
        onLeaveRequest={vi.fn()}
        roomId="room-1"
        session={session}
        snapshot={snapshotOf(game)}
      />
    </RealtimeClientProvider>,
  )
  return client
}

describe('DavinciGame', () => {
  it('상대의 감춘 타일을 고르고 숫자를 불러야 추측이 나간다', async () => {
    const user = userEvent.setup()
    const client = renderGame()

    // 타일만 고른 상태에서는 아직 부를 수 없다.
    await user.click(screen.getAllByLabelText('검정 감춘 타일')[0] as HTMLElement)
    expect(screen.getByRole('button', { name: '부르기' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '7' }))
    await user.click(screen.getByRole('button', { name: '부르기' }))

    expect(client.send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ number: 7, targetId: RIVAL, tileId: 'R0' }),
        roomId: 'room-1',
        type: 'game.davinci_code.guess',
      }),
    )
  })

  it('내 타일과 상대의 공개된 타일은 지목할 수 없다', () => {
    renderGame({
      ...state,
      hands: {
        ...state.hands,
        [RIVAL]: [tile({ id: 'R0', number: 5, revealed: true })],
      },
    })

    expect(screen.queryByRole('button', { name: '검정 5' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '검정 1' })).not.toBeInTheDocument()
  })

  it('남의 차례에는 숫자 패드 대신 기다리라고 말한다', () => {
    renderGame({ ...state, turnPlayerId: RIVAL })

    expect(screen.getByText('상대의 차례')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '부르기' })).not.toBeInTheDocument()
  })

  it('맞힌 뒤에는 이어 부를지 멈출지 고르게 한다', async () => {
    const user = userEvent.setup()
    const client = renderGame({ ...state, phase: 'DECIDING' })

    await user.click(screen.getByRole('button', { name: '한 번 더' }))

    expect(client.send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ decision: 'CONTINUE' }),
        type: 'game.davinci_code.decide',
      }),
    )
  })

  it('조커를 뽑으면 손패 사이의 자리를 고르게 한다', async () => {
    const user = userEvent.setup()
    const client = renderGame({
      ...state,
      drawn: tile({ id: 'D0', number: -1 }),
      phase: 'PLACING',
    })

    // 내 손패가 두 장이므로 넣을 수 있는 자리는 셋이다.
    await user.click(screen.getByRole('button', { name: '2번째 자리에 넣기' }))

    expect(client.send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ index: 1 }),
        type: 'game.davinci_code.place',
      }),
    )
  })
})
