import { act, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RealtimeSync } from '@/app/RealtimeSync'
import {
  createPlayingRoomSnapshot,
  creatorPlayer,
  creatorSession,
  participantPlayer,
  participantSession,
  serverMessage,
} from '@/mocks/fixtures'
import { createRealtimeFixture } from '@/mocks/realtimeScenarios'
import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import { buildClientMessage } from '@/realtime/wsEvents'
import { useAppStore } from '@/store'
import { animationSeedForRoll } from '@/yacht/model/roll/animation'

// `vi.mock`은 부른 파일에만 걸린다 — 하네스에 두면 이 스위트에는 대역이 서지 않는다.
vi.mock('@/yacht/components/PhysicsDiceScene', () => import('./physicsDiceSceneDouble'))

import { GamePlay } from '@/yacht/screens/GamePlay'
import {
  brokenSend,
  lastMsgId,
  renderGame,
  renderObserver,
  SyncedGamePlay,
  withheldResponse,
} from './gamePlayHarness'

describe('GamePlay — 굴림', () => {
  beforeEach(() => useAppStore.getState().reset())

  it('derives the same animation seed from the same server roll', () => {
    const dice = [6, 5, 4, 3, 2] as const
    expect(animationSeedForRoll('ROOM', 'player-a', 2, 3, dice)).toBe(
      animationSeedForRoll('ROOM', 'player-a', 2, 3, dice),
    )
    expect(animationSeedForRoll('ROOM', 'player-a', 2, 2, dice)).not.toBe(
      animationSeedForRoll('ROOM', 'player-a', 2, 3, dice),
    )
  })
  it('keeps a single roll CTA', async () => {
    const { user } = renderGame()

    expect(screen.getByRole('button', { name: '굴리기' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '굴리기' }))

    expect(screen.getByRole('button', { name: '굴리는 중' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    expect(screen.getByRole('button', { name: '굴리기' })).toBeEnabled()
    expect(screen.getByText('2회 남음')).toBeVisible()
  })

  it('plays the active player server roll for every other participant', () => {
    const { client } = renderObserver()

    act(() => {
      client.send(
        buildClientMessage(
          'game.yacht_dice.dice.roll',
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
      'roll-player-creator-1-1',
    )
    expect(screen.queryByRole('button', { name: '굴리기' })).not.toBeInTheDocument()
  })

  it('holds the spectator bowl until the roller throws', () => {
    vi.useFakeTimers()
    try {
      const { client } = renderObserver()
      const requestId = 'roll-player-creator-1-1'

      act(() => {
        client.send(
          buildClientMessage(
            'game.yacht_dice.dice.roll',
            { held: [false, false, false, false, false], rollCount: 1, roundNumber: 1 },
            { roomId: participantSession.roomId, msgId: 'remote-roll-1' },
          ),
        )
      })
      expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-request', requestId)

      act(() => vi.advanceTimersByTime(2_000))
      expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-release', '')

      act(() => vi.advanceTimersByTime(20_000))
      expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-release', '')

      act(() => {
        client.emitMessage(
          serverMessage(
            'game.yacht_dice.dice.thrown',
            { playerId: creatorSession.you, rollCount: 1, roundNumber: 1 },
            { roomId: participantSession.roomId },
          ),
        )
      })
      expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-release', requestId)
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases a spectator roll when thrown arrives before broadcast', () => {
    const { client } = renderObserver()
    const requestId = 'roll-player-creator-1-1'

    act(() => {
      client.emitMessage(
        serverMessage(
          'game.yacht_dice.dice.thrown',
          { playerId: creatorSession.you, rollCount: 1, roundNumber: 1 },
          { roomId: participantSession.roomId },
        ),
      )
    })
    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-release', '')

    act(() => {
      client.send(
        buildClientMessage(
          'game.yacht_dice.dice.roll',
          { held: [false, false, false, false, false], rollCount: 1, roundNumber: 1 },
          { roomId: participantSession.roomId, msgId: 'remote-roll-1' },
        ),
      )
    })

    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-request', requestId)
    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-release', requestId)
  })

  it('mirrors the roller shake pulses instead of running its own animation', () => {
    const { client } = renderObserver()

    act(() => {
      client.send(
        buildClientMessage(
          'game.yacht_dice.dice.roll',
          { held: [false, false, false, false, false], rollCount: 1, roundNumber: 1 },
          { roomId: participantSession.roomId, msgId: 'remote-roll-1' },
        ),
      )
    })
    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-follow', 'off')

    act(() => {
      client.emitMessage(
        serverMessage(
          'game.yacht_dice.dice.shaken',
          { direction: 'left', playerId: creatorSession.you, roundNumber: 1, strength: 0.5 },
          { roomId: participantSession.roomId },
        ),
      )
    })

    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-follow', 'on')
    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-pulse', 'left:0.5')
  })

  it('shows the active player special-hand effect to every other participant', async () => {
    const { client, user } = renderObserver()

    act(() => {
      client.emitMessage(
        serverMessage(
          'game.yacht_dice.dice.broadcast',
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
          'game.yacht_dice.dice.roll',
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
          'game.yacht_dice.dice.broadcast',
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

    await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    expect(screen.getByText('2회 남음')).toBeVisible()
  })

  it('accepts an authoritative own roll even when the local request id was lost', () => {
    const { client } = renderGame()

    act(() => {
      client.emitMessage(
        serverMessage(
          'game.yacht_dice.dice.broadcast',
          {
            dice: [2, 3, 4, 5, 6],
            held: [false, false, false, false, false],
            playerId: creatorSession.you,
            rollCount: 1,
            roundNumber: 1,
          },
          { msgId: 'server-authoritative-roll', roomId: creatorSession.roomId },
        ),
      )
    })

    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-target', '2,3,4,5,6')
    expect(screen.getByTestId('dice-scene')).toHaveAttribute(
      'data-request',
      'roll-player-creator-1-1',
    )
  })
  it('plays a roll delivered immediately after the server starts the next turn', () => {
    const snapshot = createPlayingRoomSnapshot(Date.now() + 30_000)
    useAppStore.getState().setRoomSession({ ...creatorSession, snapshot })
    const client = new FakeRealtimeClient()

    render(
      <RealtimeSync client={client}>
        <SyncedGamePlay />
      </RealtimeSync>,
    )

    act(() => {
      client.emitMessage(
        serverMessage('game.yacht_dice.round.start', {
          activePlayerId: participantPlayer.playerId,
          deadline: Date.now() + 30_000,
          roundNumber: 2,
          turnOrder: [creatorPlayer.playerId, participantPlayer.playerId],
        }),
      )
      client.emitMessage(
        serverMessage(
          'game.yacht_dice.dice.broadcast',
          {
            dice: [1, 2, 3, 4, 5],
            held: [false, false, false, false, false],
            playerId: participantPlayer.playerId,
            rollCount: 1,
            roundNumber: 2,
          },
          { roomId: creatorSession.roomId },
        ),
      )
    })

    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-target', '1,2,3,4,5')
    expect(screen.getByTestId('dice-scene')).toHaveAttribute(
      'data-request',
      'roll-player-participant-2-1',
    )
  })

  it('announces a new round to spectators, but not on first render', async () => {
    const snapshot = createPlayingRoomSnapshot(Date.now() + 30_000)
    if (!snapshot.game) throw new Error('playing snapshot is missing game state')
    const { snapshot: _observerSnapshot, ...observerSession } = participantSession
    const { client, rerender } = renderObserver(snapshot)

    expect(screen.queryByText(/라운드 \d+ 시작/)).not.toBeInTheDocument()

    const nextSnapshot = {
      ...snapshot,
      game: {
        ...snapshot.game,
        roundDeadline: Date.now() + 25_000,
        roundNumber: 2,
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

    expect(await screen.findByText('라운드 2 시작 — 느긋한 주사위의 턴이에요')).toBeVisible()
  })

  it('굴림 요청을 보내지 못하면 알리고 굴리기를 다시 열어 둔다', async () => {
    const client = brokenSend(createRealtimeFixture(), 'game.yacht_dice.dice.roll')
    const { user } = renderGame({ client })

    await user.click(screen.getByRole('button', { name: '굴리기' }))

    expect(
      await screen.findByText('주사위를 요청하지 못했어요. 연결 상태를 확인해 주세요.'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: '굴리기' })).toBeEnabled()
  })

  it('서버가 굴림을 거절하면 서버 문구로 알리고 다시 굴릴 수 있게 한다', async () => {
    const client = withheldResponse(createRealtimeFixture(), 'game.yacht_dice.dice.roll')
    const { user } = renderGame({ client })

    await user.click(screen.getByRole('button', { name: '굴리기' }))
    expect(screen.getByRole('button', { name: '굴리는 중' })).toBeDisabled()

    act(() => {
      client.emitMessage(
        serverMessage(
          'error',
          {
            code: 'INVALID_MESSAGE',
            message: '이미 세 번 굴렸어요.',
            refMsgId: lastMsgId(client, 'game.yacht_dice.dice.roll'),
          },
          { roomId: creatorSession.roomId },
        ),
      )
    })

    expect(await screen.findByText('이미 세 번 굴렸어요.')).toBeVisible()
    expect(screen.getByRole('button', { name: '굴리기' })).toBeEnabled()
  })

  it('다른 라운드의 굴림 브로드캐스트는 화면에 반영하지 않는다', async () => {
    const { client } = renderGame()

    act(() => {
      client.emitMessage(
        serverMessage(
          'game.yacht_dice.dice.broadcast',
          {
            dice: [1, 1, 1, 1, 1],
            held: [false, false, false, false, false],
            playerId: creatorSession.you,
            rollCount: 1,
            roundNumber: 9,
          },
          { roomId: creatorSession.roomId },
        ),
      )
    })

    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-request', '')
    expect(screen.getByRole('button', { name: '굴리기' })).toBeEnabled()
    expect(screen.getByText('3회 남음')).toBeVisible()
  })
})
