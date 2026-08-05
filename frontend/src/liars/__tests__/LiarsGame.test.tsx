import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { waitingRoomSnapshot } from '@/mocks/fixtures'
import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import type { LiarsState, RoomSnapshot } from '@/realtime/wsEvents'
import type { ActiveRoomSession } from '@/store'
import { LiarsGame } from '../LiarsGame'

const view: LiarsState = {
  bid: null,
  dice: { 'player-1': 5, 'player-2': 5 },
  lastReveal: null,
  nextActionAt: 0,
  phase: 'BIDDING',
  playerOrder: ['player-1', 'player-2'],
  round: 1,
  turnId: 'player-1',
  version: 1,
}

function snapshotOf(game: LiarsState) {
  return {
    ...waitingRoomSnapshot,
    game,
    gameCode: 'LIARS',
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

function renderGame(game: LiarsState = view) {
  const client = new FakeRealtimeClient()
  render(
    <RealtimeClientProvider client={client}>
      <LiarsGame
        onLeaveRequest={vi.fn()}
        roomId="room-1"
        session={session}
        snapshot={snapshotOf(game)}
      />
    </RealtimeClientProvider>,
  )
  return client
}

describe('LiarsGame', () => {
  /** 이 게임의 보안 계약: 남의 눈은 애초에 화면에 오지 않는다(가리는 게 아니다). */
  it('내 손패는 개인 메시지로만 그려지고 남의 자리에는 개수만 있다', () => {
    const client = renderGame()

    expect(screen.queryAllByRole('img')).toHaveLength(6) // 눈 선택 버튼 6개뿐
    client.emitMessage({
      payload: { dice: [2, 2, 4, 5, 6], round: 1 },
      ts: 0,
      type: 'game.liars.hand',
    })

    expect(screen.getByLabelText('주사위 2')).toBeInTheDocument()
    expect(screen.getAllByText('주사위 5')).toHaveLength(2) // 두 사람의 남은 개수
  })

  it('선언하면 수량과 눈을 game.liars.bid로 올린다', async () => {
    const client = renderGame()

    await userEvent.click(screen.getByLabelText('주사위 3 선택'))
    await userEvent.click(screen.getByLabelText('수량 늘리기'))
    await userEvent.click(screen.getByRole('button', { name: '선언하기' }))

    expect(client.sentMessages).toEqual([
      expect.objectContaining({
        payload: { face: 3, quantity: 2 },
        roomId: 'room-1',
        type: 'game.liars.bid',
      }),
    ])
  })

  it('선언이 서 있지 않으면 의심할 수 없다', async () => {
    renderGame()

    expect(screen.getByRole('button', { name: '의심하기' })).toBeDisabled()
  })

  it('선 선언보다 낮게는 부를 수 없고 의심이 열린다', async () => {
    const client = renderGame({
      ...view,
      bid: { face: 6, playerId: 'player-2', quantity: 3 },
      turnId: 'player-1',
    })

    // 직전 선언이 6눈 3개라 조작판은 "4개 1눈"에서 시작한다(가장 낮은 상위 선언).
    expect(screen.getByLabelText('수량 줄이기')).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '의심하기' }))

    expect(client.sentMessages).toEqual([
      expect.objectContaining({ payload: {}, type: 'game.liars.challenge' }),
    ])
  })

  it('내 차례가 아니면 조작판이 없고 누구를 기다리는지 말해준다', () => {
    renderGame({ ...view, turnId: 'player-2' })

    expect(screen.queryByRole('button', { name: '선언하기' })).not.toBeInTheDocument()
    expect(screen.getByText('상대의 차례를 기다리고 있어요')).toBeInTheDocument()
  })

  /** 챌린지 결과만이 남의 눈을 공개한다. */
  it('공개 판정에는 모두의 손패와 실제 개수가 나온다', () => {
    renderGame({
      ...view,
      dice: { 'player-1': 4, 'player-2': 5 },
      lastReveal: {
        actual: 2,
        bid: { face: 6, playerId: 'player-1', quantity: 3 },
        bidTrue: false,
        challengerId: 'player-2',
        hands: { 'player-1': [1, 2, 6, 6], 'player-2': [1, 1, 3, 4, 5] },
        loserId: 'player-1',
        round: 1,
      },
      phase: 'REVEAL',
      turnId: null,
    })

    expect(screen.getByText(/허풍이었어요/)).toBeInTheDocument()
    expect(screen.getByText(/6이\(가\) 2개/)).toBeInTheDocument()
    expect(screen.getByText(/나이\(가\) 주사위 1개를 잃었어요/)).toBeInTheDocument()
  })
})
