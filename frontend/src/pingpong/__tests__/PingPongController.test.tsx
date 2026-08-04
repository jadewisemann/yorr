import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { waitingRoomSnapshot } from '@/mocks/fixtures'
import type { PingPongState, RoomSnapshot } from '@/realtime/wsEvents'
import { PingPongController } from '../PingPongController'

const state: PingPongState = {
  ball: {
    direction: 1,
    fault: null,
    faultFrom: 0,
    launchedAt: 1_000,
    pos: 0.5,
    smash: true,
    speed: 1.95,
    x0: 0.5,
    x1: 0.7,
  },
  lastEvent: { at: 1_000, id: 3, playerId: 'player-1', type: 'SMASH' },
  lastInputSeq: { 'player-1': 1, 'player-2': 1 },
  nextActionAt: 2_000,
  phase: 'PLAYING',
  playerOrder: ['player-1', 'player-2'],
  rally: 4,
  scores: { 'player-1': 3, 'player-2': 2 },
  serveReceiverId: 'player-1',
  version: 3,
}

const snapshot = {
  ...waitingRoomSnapshot,
  game: state,
  gameCode: 'PING_PONG',
  phase: 'playing',
  players: [
    { ...waitingRoomSnapshot.players[0], nickname: '나', playerId: 'player-1' },
    { ...waitingRoomSnapshot.players[1], nickname: '상대', playerId: 'player-2' },
  ],
} as unknown as RoomSnapshot

describe('PingPongController', () => {
  it('shows a paddle-only controller with feedback and combo instead of the court', async () => {
    const user = userEvent.setup()
    const onSwing = vi.fn()
    render(
      <PingPongController
        clock={1_100}
        error={null}
        nickname="나"
        onLeave={vi.fn()}
        onSwing={onSwing}
        permission="granted"
        playerId="player-1"
        requestPermission={vi.fn()}
        snapshot={snapshot}
        state={state}
      />,
    )

    expect(screen.getByRole('button', { name: '탁구채를 휘두르기' })).toBeVisible()
    expect(screen.queryByLabelText(/3D 탁구 코트/)).not.toBeInTheDocument()
    expect(screen.getByText('스매시! 💥')).toBeVisible()
    expect(screen.getByText('COMBO')).toBeVisible()
    expect(screen.getAllByText('4')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: '화면을 눌러 스윙' }))
    expect(onSwing).toHaveBeenCalledOnce()
  })
})
