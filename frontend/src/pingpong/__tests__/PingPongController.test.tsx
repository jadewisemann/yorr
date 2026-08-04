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
  readyPlayerIds: ['player-1', 'player-2'],
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
    const onTouchSwing = vi.fn()
    render(
      <PingPongController
        clock={1_100}
        error={null}
        nickname="나"
        onLeave={vi.fn()}
        onReady={vi.fn()}
        onTouchSwing={onTouchSwing}
        permission="granted"
        playerId="player-1"
        requestPermission={vi.fn()}
        snapshot={snapshot}
        state={state}
      />,
    )

    const paddle = screen.getByRole('button', { name: '휴대폰을 휘둘러 스윙' })
    expect(paddle).toBeVisible()
    expect(screen.queryByLabelText(/3D 탁구 코트/)).not.toBeInTheDocument()
    expect(screen.getByText('스매시!')).toBeVisible()
    expect(screen.getByTestId('ping-pong-paddle-face')).toHaveAttribute('data-player-tone', 'blue')
    expect(screen.getByText('COMBO')).toBeVisible()
    expect(screen.getAllByText('4')).toHaveLength(2)

    expect(screen.getByText('모션 스윙 연결됨 · 휴대폰을 휘둘러 주세요')).toBeVisible()
    await user.click(paddle)
    expect(onTouchSwing).not.toHaveBeenCalled()
  })

  it('requires a confirmed practice swing before the player can become ready', async () => {
    const user = userEvent.setup()
    const onReady = vi.fn()
    const preparingState: PingPongState = {
      ...state,
      lastEvent: { at: 1_000, id: 4, playerId: 'player-1', type: 'PRACTICE' },
      lastInputSeq: { 'player-1': 0, 'player-2': -1 },
      phase: 'PREPARING',
      rally: 0,
      readyPlayerIds: [],
      scores: { 'player-1': 0, 'player-2': 0 },
    }

    render(
      <PingPongController
        clock={1_100}
        error={null}
        nickname="나"
        onLeave={vi.fn()}
        onReady={onReady}
        onTouchSwing={vi.fn()}
        permission="granted"
        playerId="player-1"
        requestPermission={vi.fn()}
        snapshot={{ ...snapshot, game: preparingState } as unknown as RoomSnapshot}
        state={preparingState}
      />,
    )

    expect(screen.getByRole('heading', { name: '연습 공을 쳐보세요' })).toBeVisible()
    expect(screen.getByText('스윙 감지 완료! 공을 맞혔어요')).toBeVisible()
    const ready = screen.getByRole('button', { name: '준비 완료' })
    expect(ready).toBeEnabled()
    await user.click(ready)
    expect(onReady).toHaveBeenCalledOnce()
  })

  it('activates the motion sensor without counting the activation tap as practice', async () => {
    const user = userEvent.setup()
    const requestPermission = vi.fn().mockResolvedValue(undefined)
    const onTouchSwing = vi.fn()
    const preparingState: PingPongState = {
      ...state,
      lastEvent: null,
      lastInputSeq: { 'player-1': -1, 'player-2': -1 },
      phase: 'PREPARING',
      rally: 0,
      readyPlayerIds: [],
      scores: { 'player-1': 0, 'player-2': 0 },
    }

    render(
      <PingPongController
        clock={1_100}
        error={null}
        nickname="나"
        onLeave={vi.fn()}
        onReady={vi.fn()}
        onTouchSwing={onTouchSwing}
        permission="unknown"
        playerId="player-1"
        requestPermission={requestPermission}
        snapshot={{ ...snapshot, game: preparingState } as unknown as RoomSnapshot}
        state={preparingState}
      />,
    )

    await user.click(screen.getByRole('button', { name: '연습 공 치기' }))

    expect(requestPermission).toHaveBeenCalledOnce()
    expect(onTouchSwing).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '먼저 공을 한 번 쳐보세요' })).toBeDisabled()
  })

  it('allows touch practice only as a sensor fallback', async () => {
    const user = userEvent.setup()
    const onTouchSwing = vi.fn()
    const preparingState: PingPongState = {
      ...state,
      lastEvent: null,
      lastInputSeq: { 'player-1': -1, 'player-2': -1 },
      phase: 'PREPARING',
      rally: 0,
      readyPlayerIds: [],
      scores: { 'player-1': 0, 'player-2': 0 },
    }

    render(
      <PingPongController
        clock={1_100}
        error={null}
        nickname="나"
        onLeave={vi.fn()}
        onReady={vi.fn()}
        onTouchSwing={onTouchSwing}
        permission="denied"
        playerId="player-1"
        requestPermission={vi.fn()}
        snapshot={{ ...snapshot, game: preparingState } as unknown as RoomSnapshot}
        state={preparingState}
      />,
    )

    expect(screen.getByText(/화면 터치 대체 조작/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: '연습 공 치기' }))
    expect(onTouchSwing).toHaveBeenCalledOnce()
  })

  it('uses a red paddle for player 2', () => {
    render(
      <PingPongController
        clock={1_100}
        error={null}
        nickname="P2"
        onLeave={vi.fn()}
        onReady={vi.fn()}
        onTouchSwing={vi.fn()}
        permission="granted"
        playerId="player-2"
        requestPermission={vi.fn()}
        snapshot={snapshot}
        state={state}
      />,
    )

    expect(screen.getByTestId('ping-pong-paddle-face')).toHaveAttribute('data-player-tone', 'red')
  })

  it('shows deuce and match point between rallies', () => {
    const countdownState: PingPongState = {
      ...state,
      lastEvent: null,
      phase: 'COUNTDOWN',
      rally: 0,
      scores: { 'player-1': 10, 'player-2': 10 },
    }
    const { rerender } = render(
      <PingPongController
        clock={2_000}
        error={null}
        nickname="P1"
        onLeave={vi.fn()}
        onReady={vi.fn()}
        onTouchSwing={vi.fn()}
        permission="granted"
        playerId="player-1"
        requestPermission={vi.fn()}
        snapshot={{ ...snapshot, game: countdownState } as unknown as RoomSnapshot}
        state={countdownState}
      />,
    )

    expect(screen.getByText('듀스!')).toBeVisible()

    const matchPointState: PingPongState = {
      ...countdownState,
      scores: { 'player-1': 11, 'player-2': 10 },
    }
    rerender(
      <PingPongController
        clock={2_000}
        error={null}
        nickname="P1"
        onLeave={vi.fn()}
        onReady={vi.fn()}
        onTouchSwing={vi.fn()}
        permission="granted"
        playerId="player-1"
        requestPermission={vi.fn()}
        snapshot={{ ...snapshot, game: matchPointState } as unknown as RoomSnapshot}
        state={matchPointState}
      />,
    )

    expect(screen.getByText('매치 포인트!')).toBeVisible()
  })
})
