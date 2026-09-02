import { act, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import { useAppStore } from '@/store'

// `vi.mock`은 부른 파일에만 걸린다 — 하네스에 두면 이 스위트에는 대역이 서지 않는다.
vi.mock('@/yacht/components/PhysicsDiceScene', () => import('./physicsDiceSceneDouble'))

import { GamePlay } from '@/yacht/screens/GamePlay'
import {
  broadcastRoll,
  brokenSend,
  lastMsgId,
  renderGame,
  renderObserver,
  rollAndRecord,
  withheldResponse,
} from './gamePlayHarness'

describe('제한 시간', () => {
  it('마감이 있으면 남은 시간을 헤더에 그린다', () => {
    renderGame({ snapshot: createPlayingRoomSnapshot(Date.now() + 30_000) })

    expect(screen.getByRole('timer', { name: '남은 시간' })).toBeInTheDocument()
  })

  it('마감이 없으면 타이머를 아예 그리지 않는다', async () => {
    const { user } = renderGame({ snapshot: createPlayingRoomSnapshot(null) })

    expect(screen.queryByRole('timer')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '게임 도움말' }))
    expect(screen.getByText(/제한 시간이 없어요/)).toBeInTheDocument()
    expect(screen.queryByText(/시간이 다 되면/)).not.toBeInTheDocument()
  })
})

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

    broadcastRoll(client)
    await user.click(screen.getByRole('button', { name: '굴림 완료' }))

    await user.click(screen.getByRole('button', { name: '첫 주사위 킵' }))
    expect(screen.getByText('킵 레일 · 비어 있음')).toBeVisible()
  })

  it('mirrors the active player’s keeps to everyone else', async () => {
    const { client, user } = renderObserver()

    broadcastRoll(client)
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

    await rollAndRecord(user)
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

    await rollAndRecord(user)

    expect(await screen.findByText('제출 완료 · 대기 중')).toBeVisible()
    expect(screen.queryByText('내 턴이에요')).not.toBeInTheDocument()
  })

  it('연결이 끊긴 채로 기록하면 알리고 선택 상태로 되돌린다', async () => {
    const client = brokenSend(createRealtimeFixture(), 'game.yacht_dice.round.submit')
    const { user } = renderGame({ client })

    await rollAndRecord(user)

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
      broadcastRoll(client, rollCount as 1 | 2 | 3)
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

    await rollAndRecord(user)
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
