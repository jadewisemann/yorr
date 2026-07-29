import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createEmptyScoreBoard,
  createPlayingRoomSnapshot,
  creatorSession,
  participantSession,
  serverMessage,
} from '@/mocks/fixtures'
import { createRealtimeFixture } from '@/mocks/realtimeScenarios'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import { buildClientMessage } from '@/realtime/wsEvents'
import type { PhysicsDiceRollRequest, PhysicsDiceSet } from '@/rendering/physics-dice/types'
import { useAppStore } from '@/store'
import { GamePlay } from './GamePlay'

/**
 * 물리 렌더러는 rAF와 WebGL에 의존해 jsdom에서 굴림을 끝낼 수 없다.
 * 굴림 완료를 버튼으로 노출해 CTA 상태 전이만 결정적으로 검증한다.
 */
vi.mock('@/components/PhysicsDiceScene', () => ({
  PhysicsDiceScene: ({
    onHeldToggle,
    onRollComplete,
    releaseRequestId,
    request,
  }: {
    onHeldToggle?: (index: 0) => void
    onRollComplete: (requestId: string, dice: PhysicsDiceSet) => void
    releaseRequestId: string | null
    request: PhysicsDiceRollRequest | null
  }) => (
    <div
      data-release={releaseRequestId ?? ''}
      data-request={request?.requestId ?? ''}
      data-target={request?.targetDice.join(',') ?? ''}
      data-testid="dice-scene"
    >
      {request && (
        <button onClick={() => onRollComplete(request.requestId, [6, 5, 4, 3, 2])} type="button">
          굴림 완료
        </button>
      )}
      <button onClick={() => onHeldToggle?.(0)} type="button">
        첫 주사위 킵
      </button>
    </div>
  ),
}))

const { snapshot: _snapshot, ...session } = creatorSession

function renderGame() {
  const snapshot = createPlayingRoomSnapshot(Date.now() + 30_000)
  const client = createRealtimeFixture()
  useAppStore.setState({ connectionStatus: 'connected', roomSnapshot: snapshot })
  return {
    ...render(
      <RealtimeClientProvider client={client}>
        <GamePlay roomId={session.roomId} session={session} snapshot={snapshot} />
      </RealtimeClientProvider>,
    ),
    client,
    user: userEvent.setup(),
  }
}

function renderObserver() {
  const snapshot = createPlayingRoomSnapshot(Date.now() + 30_000)
  const client = createRealtimeFixture({ role: 'creator' })
  const { snapshot: _participantSnapshot, ...observerSession } = participantSession
  useAppStore.setState({ connectionStatus: 'connected', roomSnapshot: snapshot })
  return {
    ...render(
      <RealtimeClientProvider client={client}>
        <GamePlay roomId={observerSession.roomId} session={observerSession} snapshot={snapshot} />
      </RealtimeClientProvider>,
    ),
    client,
    user: userEvent.setup(),
  }
}

describe('GamePlay', () => {
  beforeEach(() => useAppStore.getState().reset())

  it('keeps a single roll CTA', async () => {
    const { user } = renderGame()

    expect(screen.getByRole('button', { name: '굴리기' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '굴리기' }))

    // 굴리는 동안에도 버튼은 같은 자리에 남고 라벨만 바뀐다.
    expect(screen.getByRole('button', { name: '굴리는 중' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    expect(screen.getByRole('button', { name: '굴리기' })).toBeEnabled()
    expect(screen.getByText('굴림 2회 남음')).toBeVisible()
  })

  it('plays the active player server roll for every other participant', () => {
    const { client } = renderObserver()

    act(() => {
      client.send(
        buildClientMessage(
          'dice.roll',
          {
            held: [false, false, false, false, false],
            rollCount: 1,
            roundNumber: 1,
          },
          { roomId: participantSession.roomId, msgId: 'remote-roll-1' },
        ),
      )
    })

    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-target', '6,5,4,3,2')
    expect(screen.getByTestId('dice-scene')).toHaveAttribute(
      'data-request',
      'remote-player-creator-1-1-remote-roll-1',
    )
    expect(screen.queryByRole('button', { name: '굴리기' })).not.toBeInTheDocument()
  })

  it('applies the server timeout roll even though the player never requested it', async () => {
    const { client, user } = renderGame()

    act(() => {
      client.emitMessage(
        serverMessage(
          'dice.broadcast',
          {
            auto: true,
            dice: [6, 6, 6, 6, 6],
            held: [false, false, false, false, false],
            playerId: creatorSession.you,
            rollCount: 1,
            roundNumber: 1,
          },
          { roomId: creatorSession.roomId },
        ),
      )
    })

    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-target', '6,6,6,6,6')
    expect(await screen.findByText(/시간이 지나 서버가 1번째 주사위를 굴렸어요/)).toBeVisible()

    // 서버가 쓴 굴림 1회가 로컬 카운터에도 반영돼 남은 굴림이 2회로 줄어든다.
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    expect(screen.getByText('굴림 2회 남음')).toBeVisible()
  })

  it('tells the player which category the server recorded on their behalf', async () => {
    const { client } = renderGame()
    const board = createEmptyScoreBoard()

    act(() => {
      client.emitMessage(
        serverMessage(
          'score.update',
          {
            playerId: creatorSession.you,
            scoreboard: { ...board, categories: { ...board.categories, choice: 20 }, total: 20 },
          },
          { roomId: creatorSession.roomId },
        ),
      )
    })

    expect(await screen.findByText(/시간이 지나 Choice 20점으로 자동 기록됐어요/)).toBeVisible()
  })

  it('ignores dice holds while another player owns the turn', async () => {
    const { client, user } = renderObserver()

    act(() => {
      client.emitMessage(
        serverMessage(
          'dice.broadcast',
          {
            dice: [6, 5, 4, 3, 2],
            held: [false, false, false, false, false],
            playerId: creatorSession.you,
            rollCount: 1,
            roundNumber: 1,
          },
          { roomId: participantSession.roomId },
        ),
      )
    })
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))

    // 관전자가 트레이를 탭해도 킵이 생기지 않는다 — 서버가 모르는 킵은 다음 굴림을 어긋나게 한다.
    await user.click(screen.getByRole('button', { name: '첫 주사위 킵' }))
    expect(screen.getByText('킵 레일 · 비어 있음')).toBeVisible()
  })

  it('previews scores on the quick strip once dice have settled', async () => {
    const { user } = renderGame()

    // 굴리기 전에는 예상 점수가 없어 칩이 잠긴다.
    expect(screen.getByRole('button', { name: 'Choice' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '굴리기' }))
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))

    // [6,5,4,3,2] → L. Straight 30이 최고 점수로 맨 앞에 온다.
    expect(screen.getByRole('button', { name: 'L. Straight 30점 기록' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Choice 20점 기록' })).toBeEnabled()
  })

  it('opens the record panel automatically after the last roll', async () => {
    const { user } = renderGame()

    for (let roll = 0; roll < 3; roll += 1) {
      await user.click(screen.getByRole('button', { name: '굴리기' }))
      await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    }

    expect(screen.getByText('굴림 소진')).toBeVisible()
    // 패널이 열리면 토글이 "접기"로 바뀌고 전체 점수시트가 드러난다.
    const toggle = await screen.findByRole('button', { name: /접기/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    // 시트 행(정확히 "Choice 20")이 드러난다 — 퀵 칩("Choice 20점 기록")과 구분.
    expect(screen.getByRole('button', { name: 'Choice 20' })).toBeVisible()
  })

  it('records a category in one tap and then waits for the other players', async () => {
    const { user } = renderGame()

    await user.click(screen.getByRole('button', { name: '굴리기' }))
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))

    // 퀵 칩은 peek 상태에서도 보인다 — 시트를 열 필요 없이 한 번에 기록한다.
    await user.click(screen.getByRole('button', { name: 'Choice 20점 기록' }))

    expect(await screen.findByText('점수가 반영됐습니다 · 다음 턴을 기다리는 중')).toBeVisible()
  })

  it('asks for confirmation before recording a zero', async () => {
    const { user } = renderGame()

    await user.click(screen.getByRole('button', { name: '굴리기' }))
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))

    const zeroChip = screen
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-label')?.endsWith(' 0점 기록'))
    expect(zeroChip).toBeDefined()
    if (!zeroChip) return

    await user.click(zeroChip)

    expect(await screen.findByRole('dialog', { name: /0점으로 확정할까요\?/ })).toBeVisible()
  })
})
