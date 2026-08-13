import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RealtimeSync } from '@/app/RealtimeSync'
import {
  createEmptyScoreBoard,
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
import { buildClientMessage, type ClientMessageType, type RoomSnapshot } from '@/realtime/wsEvents'
import { useAppStore } from '@/store'
import { animationSeedForRoll } from '@/yacht/model/roll/animation'
import type { PhysicsDiceRollRequest, PhysicsDiceSet } from '@/yacht/rendering/physics-dice/types'
import { GamePlay } from '@/yacht/screens/GamePlay'

vi.mock('@/yacht/components/PhysicsDiceScene', () => ({
  PhysicsDiceScene: ({
    motionFollow,
    motionPulse,
    onHeldToggle,
    onRollComplete,
    releaseRequestId,
    request,
  }: {
    motionFollow?: boolean
    motionPulse?: { direction: 'left' | 'right'; id: number; strength: number } | null
    onHeldToggle?: (index: 0) => void
    onRollComplete: (requestId: string, dice: PhysicsDiceSet) => void
    releaseRequestId: string | null
    request: PhysicsDiceRollRequest | null
  }) => (
    <div
      data-follow={motionFollow ? 'on' : 'off'}
      data-pulse={motionPulse ? `${motionPulse.direction}:${motionPulse.strength}` : ''}
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

it('derives the same animation seed from the same server roll', () => {
  const dice = [6, 5, 4, 3, 2] as const
  expect(animationSeedForRoll('ROOM', 'player-a', 2, 3, dice)).toBe(
    animationSeedForRoll('ROOM', 'player-a', 2, 3, dice),
  )
  expect(animationSeedForRoll('ROOM', 'player-a', 2, 2, dice)).not.toBe(
    animationSeedForRoll('ROOM', 'player-a', 2, 3, dice),
  )
})

function renderGame(options: { client?: FakeRealtimeClient; snapshot?: RoomSnapshot } = {}) {
  const snapshot = options.snapshot ?? createPlayingRoomSnapshot(Date.now() + 30_000)
  const client = options.client ?? createRealtimeFixture()
  useAppStore.setState({ connectionStatus: 'connected', roomSnapshot: snapshot })
  const tree = (current: RoomSnapshot) => (
    <RealtimeClientProvider client={client}>
      <GamePlay
        onLeaveRequest={() => {}}
        roomId={session.roomId}
        session={session}
        snapshot={current}
      />
    </RealtimeClientProvider>
  )
  const view = render(tree(snapshot))
  return {
    ...view,
    client,
    rerenderWith: (next: RoomSnapshot) => view.rerender(tree(next)),
    user: userEvent.setup(),
  }
}

function withheldResponse(client: FakeRealtimeClient, type: ClientMessageType) {
  const send = client.send.bind(client)
  vi.spyOn(client, 'send').mockImplementation((message) => {
    if (message.type === type) {
      client.sentMessages.push(message)
      return
    }
    send(message)
  })
  return client
}

function brokenSend(client: FakeRealtimeClient, type: ClientMessageType) {
  const send = client.send.bind(client)
  vi.spyOn(client, 'send').mockImplementation((message) => {
    if (message.type === type) throw new Error('socket is closed')
    send(message)
  })
  return client
}

function lastMsgId(client: FakeRealtimeClient, type: ClientMessageType) {
  const msgId = [...client.sentMessages].reverse().find((message) => message.type === type)?.msgId
  if (!msgId) throw new Error(`no sent message of type ${type}`)
  return msgId
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

function SyncedGamePlay() {
  const roomSession = useAppStore((state) => state.roomSession)
  const roomSnapshot = useAppStore((state) => state.roomSnapshot)
  if (!roomSession || !roomSnapshot) return null
  return (
    <GamePlay
      onLeaveRequest={() => {}}
      roomId={roomSession.roomId}
      session={roomSession}
      snapshot={roomSnapshot}
    />
  )
}

describe('GamePlay', () => {
  beforeEach(() => useAppStore.getState().reset())

  it('헤더에서 도움말을 연다', async () => {
    const { user } = renderGame()

    await user.click(screen.getByRole('button', { name: '게임 도움말' }))

    expect(screen.getByRole('dialog', { name: '게임 도움말' })).toBeVisible()
  })

  it('소리 버튼이 오디오 시트를 열고 그 안에서 음소거한다', async () => {
    const { user } = renderGame()

    await user.click(screen.getByRole('button', { name: /오디오 설정/ }))
    const sheet = screen.getByRole('dialog', { name: '오디오 설정' })
    expect(sheet).toBeVisible()

    expect(within(sheet).getByRole('slider', { name: '배경음 볼륨' })).toBeVisible()
    expect(within(sheet).getByRole('slider', { name: '효과음 볼륨' })).toBeVisible()

    await user.click(within(sheet).getByRole('button', { name: '전체 음소거' }))

    expect(within(sheet).getByRole('button', { name: '소리 켜기' })).toBeVisible()
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

  it('tells the player which category the server recorded on their behalf', async () => {
    const { client } = renderGame()
    const board = createEmptyScoreBoard()

    act(() => {
      client.emitMessage(
        serverMessage(
          'game.yacht_dice.score.update',
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
          'game.yacht_dice.dice.broadcast',
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

    await user.click(screen.getByRole('button', { name: '첫 주사위 킵' }))
    expect(screen.getByText('킵 레일 · 비어 있음')).toBeVisible()
  })

  it('mirrors the active player’s keeps to everyone else', async () => {
    const { client, user } = renderObserver()

    act(() => {
      client.emitMessage(
        serverMessage(
          'game.yacht_dice.dice.broadcast',
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

    act(() => {
      client.emitMessage(
        serverMessage(
          'game.yacht_dice.dice.hold_changed',
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

    const hold = client.sentMessages.filter(
      (message) => message.type === 'game.yacht_dice.dice.hold',
    )
    expect(hold).toHaveLength(1)
    expect(hold[0]?.payload).toEqual({ held: [true, false, false, false, false], roundNumber: 1 })
  })

  it('keeps the fixed category order while previewing quick-strip scores', async () => {
    const { user } = renderGame()

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
    const toggle = await screen.findByRole('button', { name: /접기/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '초이스 20' })).toBeVisible()
  })

  it('records a category in one tap and then waits for the other players', async () => {
    const { user } = renderGame()

    await user.click(screen.getByRole('button', { name: '굴리기' }))
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))

    await user.click(screen.getByRole('button', { name: '초이스 20점 기록' }))

    expect(await screen.findByText('점수가 반영됐습니다. 다음 턴을 기다립니다.')).toBeVisible()
  })

  it('alerts once when my turn begins', async () => {
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', Object.assign(globalThis.navigator, { vibrate }))

    const { user } = renderGame()

    expect(await screen.findByText('내 차례!')).toBeVisible()
    expect(vibrate).toHaveBeenCalledTimes(1)

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

    expect(await screen.findByRole('alertdialog', { name: /0점으로 확정할까요\?/ })).toBeVisible()
  })

  it('0점 확인을 취소하면 아무것도 기록하지 않고, 확정하면 그 족보로 기록한다', async () => {
    const { client, user } = renderGame()

    await user.click(screen.getByRole('button', { name: '굴리기' }))
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    await user.click(screen.getByRole('button', { name: '에이스 0점 기록' }))
    await user.click(screen.getByRole('button', { name: '취소' }))

    expect(
      client.sentMessages.some((message) => message.type === 'game.yacht_dice.round.submit'),
    ).toBe(false)
    expect(screen.getByRole('button', { name: '에이스 0점 기록' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '에이스 0점 기록' }))
    await user.click(screen.getByRole('button', { name: '0점 확정' }))

    expect(await screen.findByText('점수가 반영됐습니다. 다음 턴을 기다립니다.')).toBeVisible()
    expect(
      client.sentMessages.find((message) => message.type === 'game.yacht_dice.round.submit')
        ?.payload,
    ).toMatchObject({ category: 'ones', roundNumber: 1 })
  })

  it('서버가 기록을 거절하면 이유를 알리고 다시 고를 수 있게 되돌린다', async () => {
    const client = withheldResponse(createRealtimeFixture(), 'game.yacht_dice.round.submit')
    const { user } = renderGame({ client })

    await user.click(screen.getByRole('button', { name: '굴리기' }))
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    await user.click(screen.getByRole('button', { name: '초이스 20점 기록' }))
    expect(screen.getByRole('button', { name: '초이스 20점 기록' })).toBeDisabled()

    act(() => {
      client.emitMessage(
        serverMessage(
          'error',
          {
            code: 'NOT_YOUR_TURN',
            message: 'turn mismatch',
            refMsgId: lastMsgId(client, 'game.yacht_dice.round.submit'),
          },
          { roomId: creatorSession.roomId },
        ),
      )
    })

    expect(await screen.findByText('지금은 내 차례가 아니에요.')).toBeVisible()
    expect(screen.getByRole('button', { name: '초이스 20점 기록' })).toBeEnabled()
  })

  it('shows a waiting label instead of repeating my own turn after I submit', async () => {
    const { user } = renderGame()

    await user.click(screen.getByRole('button', { name: '굴리기' }))
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    await user.click(screen.getByRole('button', { name: '초이스 20점 기록' }))

    expect(await screen.findByText('제출 완료 · 대기 중')).toBeVisible()
    expect(screen.queryByText('내 턴이에요')).not.toBeInTheDocument()
  })

  it('연결이 끊긴 채로 기록하면 알리고 선택 상태로 되돌린다', async () => {
    const client = brokenSend(createRealtimeFixture(), 'game.yacht_dice.round.submit')
    const { user } = renderGame({ client })

    await user.click(screen.getByRole('button', { name: '굴리기' }))
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    await user.click(screen.getByRole('button', { name: '초이스 20점 기록' }))

    expect(await screen.findByText('점수를 기록하지 못했어요. 다시 시도해 주세요.')).toBeVisible()
    expect(screen.getByRole('button', { name: '초이스 20점 기록' })).toBeEnabled()
  })

  it('writes the subject particle as (이)가 for arbitrary nicknames', () => {
    renderObserver()

    expect(screen.getByText('느긋한 주사위(이)가 굴리는 중')).toBeVisible()
  })

  it('closes the record panel once the turn moves away from the player I was watching', async () => {
    const snapshot = createPlayingRoomSnapshot(Date.now() + 30_000)
    if (!snapshot.game) throw new Error('playing snapshot is missing game state')
    const { snapshot: _observerSnapshot, ...observerSession } = participantSession
    const { client, rerender, user } = renderObserver(snapshot)

    for (let rollCount = 1; rollCount <= 3; rollCount += 1) {
      act(() => {
        client.emitMessage(
          serverMessage(
            'game.yacht_dice.dice.broadcast',
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

  it('턴이 넘어가면 이전 턴에서 잡아 둔 킵과 주사위를 버린다', async () => {
    const { rerenderWith, user } = renderGame()

    await user.click(screen.getByRole('button', { name: '굴리기' }))
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    await user.click(screen.getByRole('button', { name: '첫 주사위 킵' }))
    expect(screen.getByText(/킵 레일 · 1\/5 · 합 6/)).toBeVisible()

    const handoff = createPlayingRoomSnapshot(Date.now() + 30_000)
    if (!handoff.game) throw new Error('playing snapshot is missing game state')
    handoff.game.activePlayerId = participantPlayer.playerId
    rerenderWith(handoff)

    expect(screen.getByText('킵 레일 · 비어 있음')).toBeVisible()
    expect(screen.getByText(`${participantPlayer.nickname}의 턴`)).toBeVisible()
  })

  it('턴이 바뀌면 응답을 받지 못한 점수 제출 상태를 폐기한다', async () => {
    const client = withheldResponse(createRealtimeFixture(), 'game.yacht_dice.round.submit')
    const snapshot = createPlayingRoomSnapshot(Date.now() + 30_000)
    if (!snapshot.game) throw new Error('playing snapshot is missing game state')
    const { rerenderWith, user } = renderGame({ client, snapshot })

    await user.click(screen.getByRole('button', { name: '굴리기' }))
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    await user.click(screen.getByRole('button', { name: '초이스 20점 기록' }))
    expect(screen.getByRole('button', { name: '초이스 20점 기록' })).toBeDisabled()

    rerenderWith({
      ...snapshot,
      game: {
        ...snapshot.game,
        activePlayerId: participantPlayer.playerId,
        roundNumber: 2,
      },
    })
    rerenderWith({
      ...snapshot,
      game: {
        ...snapshot.game,
        activePlayerId: creatorPlayer.playerId,
        roundNumber: 3,
      },
    })

    await user.click(screen.getByRole('button', { name: '굴리기' }))
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    expect(screen.getByRole('button', { name: '초이스 20점 기록' })).toBeEnabled()
  })

  it('내 점수판이 갱신돼도 새로 채워진 칸이 없으면 자동 기록을 알리지 않는다', async () => {
    const { client } = renderGame()
    const board = createEmptyScoreBoard()

    act(() => {
      client.emitMessage(
        serverMessage(
          'game.yacht_dice.score.update',
          { playerId: creatorSession.you, scoreboard: { ...board, upperSubtotal: 0, total: 0 } },
          { roomId: creatorSession.roomId },
        ),
      )
    })

    expect(await screen.findByText('내 차례!')).toBeVisible()
    expect(screen.queryByText(/자동 기록/)).not.toBeInTheDocument()
  })

  it('참가자가 셋이어도 내 열만 맨 앞으로 오고 나머지 명단 순서는 그대로다', () => {
    const snapshot = createPlayingRoomSnapshot(Date.now() + 30_000)
    const thirdPlayer = { playerId: 'player-third', nickname: '세 번째', status: 'online' } as const
    snapshot.players = [thirdPlayer, creatorPlayer, participantPlayer]

    renderGame({ snapshot })

    const scoreSheet = screen.getByRole('region', { name: '플레이어별 점수표' })
    const columns = Array.from(scoreSheet.querySelectorAll('[title]'), (badge) =>
      badge.getAttribute('title'),
    )
    expect(columns).toEqual(['나', thirdPlayer.nickname, participantPlayer.nickname])
  })
})
