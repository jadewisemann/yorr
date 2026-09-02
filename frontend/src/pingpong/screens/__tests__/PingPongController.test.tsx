import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { playingSnapshot, playingState } from '@/pingpong/__tests__/pingPongFixtures'
import { PingPongController } from '@/pingpong/screens/PingPongController'
import type { PingPongState } from '@/realtime/wsEvents'

const state = playingState({
  ball: { ...playingState().ball, smash: true },
  lastEvent: { at: 1_000, id: 3, playerId: 'player-1', type: 'SMASH' },
  rally: 4,
})

/** 준비 단계의 상태. 연습 스윙과 준비 완료를 보는 검사들이 여기서 갈린다. */
const preparing = (overrides: Partial<PingPongState> = {}): PingPongState => ({
  ...state,
  lastEvent: null,
  lastInputSeq: { 'player-1': -1, 'player-2': -1 },
  phase: 'PREPARING',
  rally: 0,
  readyPlayerIds: [],
  scores: { 'player-1': 0, 'player-2': 0 },
  ...overrides,
})

type ControllerOverrides = {
  nickname?: string
  playerId?: string
  onReady?: () => void
  onTouchSwing?: () => void
  permission?: 'unknown' | 'granted' | 'denied'
  requestPermission?: () => Promise<void>
  state?: PingPongState
}

/** 컨트롤러 한 대. 검사마다 달라지는 것은 콜백·권한·상태뿐이다. */
function renderController(overrides: ControllerOverrides = {}) {
  const shown = overrides.state ?? state
  render(
    <PingPongController
      clock={1_100}
      error={null}
      nickname={overrides.nickname ?? '나'}
      onLeave={vi.fn()}
      onReady={overrides.onReady ?? vi.fn()}
      onTouchSwing={overrides.onTouchSwing ?? vi.fn()}
      permission={overrides.permission ?? 'granted'}
      playerId={overrides.playerId ?? 'player-1'}
      requestPermission={overrides.requestPermission ?? vi.fn()}
      snapshot={playingSnapshot(shown)}
      state={shown}
    />,
  )
}

describe('@/pingpong/screens/PingPongController', () => {
  it('shows a paddle-only controller with feedback and combo instead of the court', async () => {
    const user = userEvent.setup()
    const onTouchSwing = vi.fn()
    renderController({ onTouchSwing: onTouchSwing })

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
    const preparingState = preparing({
      lastEvent: { at: 1_000, id: 4, playerId: 'player-1', type: 'PRACTICE' },
      lastInputSeq: { 'player-1': 0, 'player-2': -1 },
    })

    renderController({ onReady: onReady, state: preparingState })

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
    const preparingState = preparing()

    renderController({
      onTouchSwing: onTouchSwing,
      permission: 'unknown',
      requestPermission: requestPermission,
      state: preparingState,
    })

    await user.click(screen.getByRole('button', { name: '연습 공 치기' }))

    expect(requestPermission).toHaveBeenCalledOnce()
    expect(onTouchSwing).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '먼저 공을 한 번 쳐보세요' })).toBeDisabled()
  })

  it('allows touch practice only as a sensor fallback', async () => {
    const user = userEvent.setup()
    const onTouchSwing = vi.fn()
    const preparingState = preparing()

    renderController({ onTouchSwing: onTouchSwing, permission: 'denied', state: preparingState })

    expect(screen.getByText(/화면 터치 대체 조작/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: '연습 공 치기' }))
    expect(onTouchSwing).toHaveBeenCalledOnce()
  })

  it('uses a red paddle and P2 identity for player 2', () => {
    renderController({ nickname: '상대', playerId: 'player-2' })

    expect(screen.getByTestId('ping-pong-paddle-face')).toHaveAttribute('data-player-tone', 'red')
    expect(screen.getByText('P2')).toBeVisible()
  })

  it('shows deuce and match point between rallies', () => {
    const countdownState: PingPongState = {
      ...state,
      lastEvent: null,
      phase: 'COUNTDOWN',
      rally: 0,
      scores: { 'player-1': 10, 'player-2': 10 },
    }
    const clockAt2s = (shown: PingPongState) => (
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
        snapshot={playingSnapshot(shown)}
        state={shown}
      />
    )
    const { rerender } = render(clockAt2s(countdownState))

    expect(screen.getByText('듀스!')).toBeVisible()

    rerender(clockAt2s({ ...countdownState, scores: { 'player-1': 11, 'player-2': 10 } }))

    expect(screen.getByText('매치 포인트!')).toBeVisible()
  })
})
