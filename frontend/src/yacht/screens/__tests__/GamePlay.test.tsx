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
import type { PhysicsDiceRollRequest, PhysicsDiceSet } from '@/yacht/rendering/physics-dice/types'
import { GamePlay } from '@/yacht/screens/GamePlay'
import { animationSeedForRoll } from '@/yacht/screens/gamePlayModel'

/**
 * 물리 렌더러는 rAF와 WebGL에 의존해 jsdom에서 굴림을 끝낼 수 없다.
 * 굴림 완료를 버튼으로 노출해 CTA 상태 전이만 결정적으로 검증한다.
 */
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
    /** 서버가 새 스냅샷을 내려준 상황 — GamePage가 prop을 갈아 끼우는 것과 같다. */
    rerenderWith: (next: RoomSnapshot) => view.rerender(tree(next)),
    user: userEvent.setup(),
  }
}

/** 요청은 나갔지만 서버 응답이 아직 없는 구간을 테스트가 직접 열어 둔다. */
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

/** 소켓이 죽은 상태 — 해당 타입 전송만 실패한다. */
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

  it('헤더에서 도움말을 열고 소리 상태를 바꿄다', async () => {
    const { user } = renderGame()
    const soundButton = screen.getByRole('button', { name: /소리 [켜끄]기/ })
    const initialPressed = soundButton.getAttribute('aria-pressed')

    await user.click(screen.getByRole('button', { name: '게임 도움말' }))
    expect(screen.getByRole('dialog', { name: '게임 도움말' })).toBeVisible()

    await user.click(soundButton)
    expect(soundButton.getAttribute('aria-pressed')).not.toBe(initialPressed)
  })

  it('keeps a single roll CTA', async () => {
    const { user } = renderGame()

    expect(screen.getByRole('button', { name: '굴리기' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '굴리기' }))

    // 굴리는 동안에도 버튼은 같은 자리에 남고 라벨만 바뀐다.
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
      'roll-player-creator-1-1',
    )
    expect(screen.queryByRole('button', { name: '굴리기' })).not.toBeInTheDocument()
  })

  /**
   * dice.roll은 흔들기 시작에 나가 주사위 눈을 미리 확정한다. 그래서 관전 화면이 브로드캐스트만
   * 보고 사발을 쏟으면, 굴린 사람이 아직 흔드는 중인데 결과가 먼저 보인다(미래를 보는 화면).
   */
  it('holds the spectator bowl until the roller throws', () => {
    vi.useFakeTimers()
    try {
      const { client } = renderObserver()
      const requestId = 'roll-player-creator-1-1'

      act(() => {
        client.send(
          buildClientMessage(
            'dice.roll',
            { held: [false, false, false, false, false], rollCount: 1, roundNumber: 1 },
            { roomId: participantSession.roomId, msgId: 'remote-roll-1' },
          ),
        )
      })
      expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-request', requestId)

      // 흔드는 동안에는 사발에 담겨 있어야 한다.
      act(() => vi.advanceTimersByTime(2_000))
      expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-release', '')

      // 아무리 오래 흔들어도 시간이 대신 쏟아주지 않는다 — 관전 화면은 굴리는 사람 화면을
      // 그대로 따라가고, 쏟는 시점은 오직 dice.thrown이 정한다.
      act(() => vi.advanceTimersByTime(20_000))
      expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-release', '')

      act(() => {
        client.emitMessage(
          serverMessage(
            'dice.thrown',
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
          'dice.thrown',
          { playerId: creatorSession.you, rollCount: 1, roundNumber: 1 },
          { roomId: participantSession.roomId },
        ),
      )
    })
    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-release', '')

    act(() => {
      client.send(
        buildClientMessage(
          'dice.roll',
          { held: [false, false, false, false, false], rollCount: 1, roundNumber: 1 },
          { roomId: participantSession.roomId, msgId: 'remote-roll-1' },
        ),
      )
    })

    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-request', requestId)
    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-release', requestId)
  })

  /**
   * 폰으로 굴리면 사발은 기기 흔들림 펄스로만 흔들린다 — 손을 멈추면 주사위도 잦아든다.
   * 관전 화면이 그 펄스를 받지 못하면 정해진 애니메이션으로 혼자 계속 흔들어, 굴린 사람이
   * 멈춘 뒤에도 남의 화면에서만 사발이 움직인다.
   */
  it('mirrors the roller shake pulses instead of running its own animation', () => {
    const { client } = renderObserver()

    act(() => {
      client.send(
        buildClientMessage(
          'dice.roll',
          { held: [false, false, false, false, false], rollCount: 1, roundNumber: 1 },
          { roomId: participantSession.roomId, msgId: 'remote-roll-1' },
        ),
      )
    })
    // 아직 펄스가 없다 = 버튼으로 굴렸을 수도 있다. 그때는 기존 애니메이션이 돌아야 한다.
    expect(screen.getByTestId('dice-scene')).toHaveAttribute('data-follow', 'off')

    act(() => {
      client.emitMessage(
        serverMessage(
          'dice.shaken',
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
    expect(screen.getByText('2회 남음')).toBeVisible()
  })

  it('accepts an authoritative own roll even when the local request id was lost', () => {
    const { client } = renderGame()

    act(() => {
      client.emitMessage(
        serverMessage(
          'dice.broadcast',
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

  /** QA 7번. 내 차례가 시작될 때만 알리고, 렌더마다 다시 알리지 않는다.
   *  하단 토스트는 시선 밖이라, 족보 이펙트와 같은 대형 콜아웃으로 알린다. */
  it('alerts once when my turn begins', async () => {
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', Object.assign(globalThis.navigator, { vibrate }))

    const { user } = renderGame()

    expect(await screen.findByText('내 차례!')).toBeVisible()
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

    expect(await screen.findByRole('alertdialog', { name: /0점으로 확정할까요\?/ })).toBeVisible()
  })

  it('0점 확인을 취소하면 아무것도 기록하지 않고, 확정하면 그 족보로 기록한다', async () => {
    const { client, user } = renderGame()

    await user.click(screen.getByRole('button', { name: '굴리기' }))
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    await user.click(screen.getByRole('button', { name: '에이스 0점 기록' }))
    await user.click(screen.getByRole('button', { name: '취소' }))

    // 취소는 되돌릴 수 없는 선택을 실제로 막아야 한다 — 서버로 아무것도 나가지 않는다.
    expect(client.sentMessages.some((message) => message.type === 'round.submit')).toBe(false)
    expect(screen.getByRole('button', { name: '에이스 0점 기록' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '에이스 0점 기록' }))
    await user.click(screen.getByRole('button', { name: '0점 확정' }))

    expect(await screen.findByText('점수가 반영됐습니다. 다음 턴을 기다립니다.')).toBeVisible()
    expect(
      client.sentMessages.find((message) => message.type === 'round.submit')?.payload,
    ).toMatchObject({ category: 'ones', roundNumber: 1 })
  })

  it('서버가 기록을 거절하면 이유를 알리고 다시 고를 수 있게 되돌린다', async () => {
    const client = withheldResponse(createRealtimeFixture(), 'round.submit')
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
            refMsgId: lastMsgId(client, 'round.submit'),
          },
          { roomId: creatorSession.roomId },
        ),
      )
    })

    // 서버 코드는 그대로 노출하지 않고 지금 상황을 설명하는 문장으로 바꿔 준다.
    expect(await screen.findByText('지금은 내 차례가 아니에요.')).toBeVisible()
    expect(screen.getByRole('button', { name: '초이스 20점 기록' })).toBeEnabled()
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

  it('연결이 끊긴 채로 기록하면 알리고 선택 상태로 되돌린다', async () => {
    const client = brokenSend(createRealtimeFixture(), 'round.submit')
    const { user } = renderGame({ client })

    await user.click(screen.getByRole('button', { name: '굴리기' }))
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))
    await user.click(screen.getByRole('button', { name: '초이스 20점 기록' }))

    expect(await screen.findByText('점수를 기록하지 못했어요. 다시 시도해 주세요.')).toBeVisible()
    expect(screen.getByRole('button', { name: '초이스 20점 기록' })).toBeEnabled()
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
        serverMessage('round.start', {
          activePlayerId: participantPlayer.playerId,
          deadline: Date.now() + 30_000,
          roundNumber: 2,
          turnOrder: [creatorPlayer.playerId, participantPlayer.playerId],
        }),
      )
      client.emitMessage(
        serverMessage(
          'dice.broadcast',
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

  /** QA FND-7: 라운드가 바뀌는 순간은 관전자에게도 알린다. 첫 렌더(중간 입장)는 전환이 아니다. */
  it('announces a new round to spectators, but not on first render', async () => {
    const snapshot = createPlayingRoomSnapshot(Date.now() + 30_000)
    if (!snapshot.game) throw new Error('playing snapshot is missing game state')
    const { snapshot: _observerSnapshot, ...observerSession } = participantSession
    const { client, rerender } = renderObserver(snapshot)

    expect(screen.queryByText(/라운드 \d+ 시작/)).not.toBeInTheDocument()

    // round.start 반영은 RealtimeSync 몫이라 새 snapshot으로 rerender해 흉내낸다(위 테스트와 동일).
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
    const client = brokenSend(createRealtimeFixture(), 'dice.roll')
    const { user } = renderGame({ client })

    await user.click(screen.getByRole('button', { name: '굴리기' }))

    expect(
      await screen.findByText('주사위를 요청하지 못했어요. 연결 상태를 확인해 주세요.'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: '굴리기' })).toBeEnabled()
  })

  it('서버가 굴림을 거절하면 서버 문구로 알리고 다시 굴릴 수 있게 한다', async () => {
    const client = withheldResponse(createRealtimeFixture(), 'dice.roll')
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
            refMsgId: lastMsgId(client, 'dice.roll'),
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
          'dice.broadcast',
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

    // 남은 킵을 물려주면 다음 턴 주인의 첫 굴림이 서버와 어긋난다.
    expect(screen.getByText('킵 레일 · 비어 있음')).toBeVisible()
    expect(screen.getByText(`${participantPlayer.nickname}의 턴`)).toBeVisible()
  })

  it('턴이 바뀌면 응답을 받지 못한 점수 제출 상태를 폐기한다', async () => {
    const client = withheldResponse(createRealtimeFixture(), 'round.submit')
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
          'score.update',
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
    // 내가 명단 가운데 있어도 첫 열이어야 한다 — 내 점수를 찾느라 좌우로 훑지 않게.
    snapshot.players = [thirdPlayer, creatorPlayer, participantPlayer]

    renderGame({ snapshot })

    const scoreSheet = screen.getByRole('region', { name: '플레이어별 점수표' })
    const columns = Array.from(scoreSheet.querySelectorAll('[title]'), (badge) =>
      badge.getAttribute('title'),
    )
    expect(columns).toEqual(['나', thirdPlayer.nickname, participantPlayer.nickname])
  })
})
