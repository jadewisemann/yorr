import { act, render, screen, within } from '@testing-library/react'
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

function renderObserver(snapshot = createPlayingRoomSnapshot(Date.now() + 30_000)) {
  const client = createRealtimeFixture({ role: 'creator' })
  const { snapshot: _participantSnapshot, ...observerSession } = participantSession
  useAppStore.setState({ connectionStatus: 'connected', roomSnapshot: snapshot })
  return {
    ...render(
      <RealtimeClientProvider client={client}>
        <GamePlay
          onLeaveRequest={() => {}}
          roomId={observerSession.roomId}
          session={observerSession}
          snapshot={snapshot}
        />
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
    expect(screen.getByText('남은 굴리기 2회')).toBeVisible()
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

  it('shows the active player special-hand effect to every other participant', async () => {
    const { client, user } = renderObserver()

    act(() => {
      client.emitMessage(
        serverMessage(
          'dice.broadcast',
          {
            dice: [6, 6, 6, 6, 6],
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

    expect(screen.getByText('요트!!!')).toBeVisible()
  })

  it('previews a remote roll in the active player column', async () => {
    const snapshot = createPlayingRoomSnapshot(Date.now() + 30_000)
    const creatorBoard = snapshot.game?.scores[creatorSession.you]
    if (!snapshot.game || !creatorBoard) throw new Error('playing snapshot is missing game scores')
    snapshot.game.scores[creatorSession.you] = {
      ...creatorBoard,
      categories: { ...creatorBoard.categories, ones: 1 },
      upperSubtotal: 1,
      total: 1,
    }

    const { client, user } = renderObserver(snapshot)
    expect(screen.getByText('기록 — 느긋한 주사위')).toBeVisible()

    act(() => {
      client.send(
        buildClientMessage(
          'dice.roll',
          {
            held: [false, false, false, false, false],
            rollCount: 1,
            roundNumber: 1,
          },
          { roomId: participantSession.roomId, msgId: 'remote-preview-1' },
        ),
      )
    })
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))

    const scoreSheet = screen.getByRole('region', { name: '플레이어별 점수표' })
    const choiceRow = within(scoreSheet).getByText('초이스').closest('div')
    expect(choiceRow).not.toBeNull()
    if (!choiceRow) return
    expect(Array.from(choiceRow.children, (cell) => cell.textContent)).toEqual([
      '초이스',
      '·',
      '20',
    ])
    expect(screen.queryByRole('button', { name: '에이스 0점 기록' })).not.toBeInTheDocument()
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
    expect(screen.getByText('남은 굴리기 2회')).toBeVisible()
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

    expect(await screen.findByText(/시간이 지나 초이스 20점으로 자동 기록됐어요/)).toBeVisible()
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

  it('mirrors the active player’s keeps to everyone else', async () => {
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
    expect(screen.getByText('킵 레일 · 비어 있음')).toBeVisible()

    // 턴 주인이 굴림 사이에 킵을 바꾸면 관전자 화면도 따라와야 한다.
    act(() => {
      client.emitMessage(
        serverMessage(
          'dice.hold_changed',
          {
            held: [true, true, false, false, false],
            playerId: creatorSession.you,
            roundNumber: 1,
          },
          { roomId: participantSession.roomId },
        ),
      )
    })

    expect(await screen.findByText(/킵 레일 · 2\/5 · 합 11/)).toBeVisible()
  })

  it('tells the server when keeps change between rolls', async () => {
    const { client, user } = renderGame()

    await user.click(screen.getByRole('button', { name: '굴리기' }))
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    await user.click(screen.getByRole('button', { name: '첫 주사위 킵' }))

    // 굴림 사이의 킵 변경이 서버로 나가야 상대 화면이 따라올 수 있다.
    const hold = client.sentMessages.filter((message) => message.type === 'dice.hold')
    expect(hold).toHaveLength(1)
    expect(hold[0]?.payload).toEqual({ held: [true, false, false, false, false], roundNumber: 1 })
  })

  it('keeps the fixed category order while previewing quick-strip scores', async () => {
    const { user } = renderGame()

    // 굴리기 전에는 예상 점수가 없어 칩이 잠긴다.
    expect(screen.getByRole('button', { name: '초이스' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '굴리기' }))
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))

    const sixes = screen.getByRole('button', { name: '식스 6점 기록' })
    const choice = screen.getByRole('button', { name: '초이스 20점 기록' })
    const largeStraight = screen.getByRole('button', { name: '라지 스트레이트 30점 기록' })
    expect(sixes).toBeEnabled()
    expect(choice.compareDocumentPosition(largeStraight) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
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
    // 시트 행(정확히 "초이스 20")이 드러난다 — 퀵 칩("초이스 20점 기록")과 구분.
    expect(screen.getByRole('button', { name: '초이스 20' })).toBeVisible()
  })

  it('records a category in one tap and then waits for the other players', async () => {
    const { user } = renderGame()

    await user.click(screen.getByRole('button', { name: '굴리기' }))
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))

    // 퀵 칩은 peek 상태에서도 보인다 — 시트를 열 필요 없이 한 번에 기록한다.
    await user.click(screen.getByRole('button', { name: '초이스 20점 기록' }))

    expect(await screen.findByText('점수가 반영됐습니다. 다음 턴을 기다립니다.')).toBeVisible()
  })

  /** QA 7번. 내 차례가 시작될 때만 알리고, 렌더마다 다시 알리지 않는다. */
  it('alerts once when my turn begins', async () => {
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', Object.assign(globalThis.navigator, { vibrate }))

    const { user } = renderGame()

    expect(await screen.findByText('내 차례예요! 주사위를 굴려 주세요')).toBeVisible()
    expect(vibrate).toHaveBeenCalledTimes(1)

    // 굴려서 리렌더가 여러 번 일어나도 알림은 늘지 않는다.
    await user.click(screen.getByRole('button', { name: '굴리기' }))
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    expect(vibrate).toHaveBeenCalledTimes(1)
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

  /** QA FND-3: 제출 직후엔 activePlayerId가 아직 나라서, 내 이름을 "OO의 턴"으로 반복하는 대신
   *  대기 중임을 분명히 말해야 한다. */
  it('shows a waiting label instead of repeating my own turn after I submit', async () => {
    const { user } = renderGame()

    await user.click(screen.getByRole('button', { name: '굴리기' }))
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    await user.click(screen.getByRole('button', { name: '초이스 20점 기록' }))

    expect(await screen.findByText('제출 완료 · 대기 중')).toBeVisible()
    expect(screen.queryByText('내 턴이에요')).not.toBeInTheDocument()
  })

  /** QA FND-9: 닉네임은 임의 입력이라 받침 유무를 알 수 없다 — "(으)로"와 같은 방식으로 이/가를 적는다. */
  it('writes the subject particle as (이)가 for arbitrary nicknames', () => {
    renderObserver()

    expect(screen.getByText('느긋한 주사위(이)가 굴리는 중')).toBeVisible()
  })

  /**
   * QA FND-5: 남의 턴을 구경하며 열어둔 점수시트가 턴이 넘어간 뒤에도 남아있으면 안 된다.
   * round.start는 RealtimeSync(상위 컴포넌트)가 듣고 snapshot prop을 새로 내려주는 몫이라, 이
   * 단위 테스트에선 그 결과를 직접 흉내내 새 snapshot으로 rerender한다.
   */
  it('closes the record panel once the turn moves away from the player I was watching', async () => {
    const snapshot = createPlayingRoomSnapshot(Date.now() + 30_000)
    if (!snapshot.game) throw new Error('playing snapshot is missing game state')
    const { snapshot: _observerSnapshot, ...observerSession } = participantSession
    const { client, rerender, user } = renderObserver(snapshot)

    for (let rollCount = 1; rollCount <= 3; rollCount += 1) {
      act(() => {
        client.emitMessage(
          serverMessage(
            'dice.broadcast',
            {
              dice: [6, 5, 4, 3, 2],
              held: [false, false, false, false, false],
              playerId: creatorSession.you,
              rollCount: rollCount as 1 | 2 | 3,
              roundNumber: 1,
            },
            { roomId: participantSession.roomId },
          ),
        )
      })
      await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    }

    const toggle = await screen.findByRole('button', { name: /접기/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    const nextSnapshot = {
      ...snapshot,
      game: {
        ...snapshot.game,
        activePlayerId: participantSession.you,
        roundDeadline: Date.now() + 25_000,
        roundNumber: 2,
        turnOrder: [creatorSession.you, participantSession.you],
      },
    }
    rerender(
      <RealtimeClientProvider client={client}>
        <GamePlay
          onLeaveRequest={() => {}}
          roomId={observerSession.roomId}
          session={observerSession}
          snapshot={nextSnapshot}
        />
      </RealtimeClientProvider>,
    )

    expect(await screen.findByText('내 턴이에요')).toBeVisible()
    expect(screen.getByRole('button', { name: /전체 시트/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })
})
