import { describe, expect, it } from 'vitest'
import type { ServerMessage } from '@/realtime/wsEvents'
import { buildClientMessage } from '@/realtime/wsEvents'
import {
  createTutorialClient,
  createTutorialSnapshot,
  TUTORIAL_PLAYER_ID,
  TUTORIAL_ROOM_ID,
} from '@/yacht/domain/tutorialGame'

function sendAndCollect(
  client: ReturnType<typeof createTutorialClient>,
  message: Parameters<ReturnType<typeof createTutorialClient>['send']>[0],
) {
  const received: ServerMessage[] = []
  const stop = client.onMessage((reply) => received.push(reply))
  client.send(message)
  stop()
  return received
}

function rollAndRead(
  client: ReturnType<typeof createTutorialClient>,
  rollCount: 1 | 2 | 3,
  held: [boolean, boolean, boolean, boolean, boolean],
) {
  let dice: readonly number[] | null = null
  const stop = client.onMessage((message) => {
    if (message.type === 'game.yacht_dice.dice.broadcast') dice = message.payload.dice
  })
  client.send(
    buildClientMessage(
      'game.yacht_dice.dice.roll',
      { held, rollCount, roundNumber: 1 },
      { roomId: TUTORIAL_ROOM_ID },
    ),
  )
  stop()
  if (!dice) throw new Error('연습 서버가 주사위를 돌려주지 않았다')
  return dice as readonly number[]
}

const NONE: [boolean, boolean, boolean, boolean, boolean] = [false, false, false, false, false]

describe('연습 모드 주사위', () => {
  it('굴릴수록 6이 늘어나는 대본을 따른다 — 마지막에는 식스 24점', () => {
    const client = createTutorialClient()

    expect(rollAndRead(client, 1, NONE)).toEqual([6, 6, 2, 3, 5])
    expect(rollAndRead(client, 2, NONE)).toEqual([6, 6, 6, 4, 1])
    expect(rollAndRead(client, 3, NONE)).toEqual([6, 6, 6, 6, 2])
  })

  it('킵한 자리는 대본이 덮지 않는다', () => {
    const client = createTutorialClient()

    rollAndRead(client, 1, NONE) // [6, 6, 2, 3, 5]
    const second = rollAndRead(client, 2, [false, false, true, false, false])

    expect(second[2]).toBe(2)
    expect(second).toEqual([6, 6, 2, 4, 1])
  })

  it('안내와 다르게 킵해도 흐름이 끊기지 않는다 — 6은 계속 늘어난다', () => {
    const client = createTutorialClient()

    rollAndRead(client, 1, NONE)
    const second = rollAndRead(client, 2, [false, false, true, true, true])
    const sixes = (dice: readonly number[]) => dice.filter((value) => value === 6).length

    expect(sixes(second)).toBeGreaterThanOrEqual(2)
  })
})

describe('연습판 초기 상태', () => {
  it('혼자 플레이하는 1라운드 판이고, 마감이 없다', () => {
    const snapshot = createTutorialSnapshot()

    expect(snapshot.phase).toBe('playing')
    expect(snapshot.players).toHaveLength(1)
    expect(snapshot.game?.activePlayerId).toBe(TUTORIAL_PLAYER_ID)
    expect(snapshot.game?.roundNumber).toBe(1)
    expect(snapshot.game?.rollCount).toBe(0)
    // 예전에는 1시간짜리 가짜 마감이었다 — 계약이 null을 받게 되면서 진짜로 없다.
    expect(snapshot.game?.roundDeadline).toBeNull()
    const board = snapshot.game?.scores[TUTORIAL_PLAYER_ID]
    expect(Object.values(board?.categories ?? {}).every((score) => score === null)).toBe(true)
    expect(board?.total).toBe(0)
  })
})

describe('연습 모드 킵·기록', () => {
  it('킵을 바꾸면 실서버와 같은 hold_changed로 돌려준다', () => {
    const client = createTutorialClient()
    const held = [true, false, true, false, false] as const

    const received = sendAndCollect(
      client,
      buildClientMessage(
        'game.yacht_dice.dice.hold',
        { held, roundNumber: 1 },
        { roomId: TUTORIAL_ROOM_ID },
      ),
    )

    expect(received).toHaveLength(1)
    expect(received[0]?.type).toBe('game.yacht_dice.dice.hold_changed')
    if (received[0]?.type !== 'game.yacht_dice.dice.hold_changed')
      throw new Error('hold_changed가 아니다')
    expect(received[0].payload.held).toEqual(held)
    expect(received[0].payload.playerId).toBe(TUTORIAL_PLAYER_ID)
  })

  it('족보를 기록하면 점수판을 계산해 score.update로 돌려준다', () => {
    const client = createTutorialClient()

    const received = sendAndCollect(
      client,
      buildClientMessage(
        'game.yacht_dice.round.submit',
        { roundNumber: 1, dice: [6, 6, 6, 6, 2], category: 'sixes' },
        { roomId: TUTORIAL_ROOM_ID },
      ),
    )

    expect(received).toHaveLength(1)
    if (received[0]?.type !== 'game.yacht_dice.score.update')
      throw new Error('score.update가 아니다')
    const board = received[0].payload.scoreboard
    expect(board.categories.sixes).toBe(24)
    expect(board.upperSubtotal).toBe(24)
    expect(board.total).toBe(24)
    expect(board.categories.yacht).toBeNull()
  })

  it('하트비트는 받아 줄 서버가 없으므로 조용히 삼킨다', () => {
    const client = createTutorialClient()

    const received = sendAndCollect(
      client,
      buildClientMessage('sys.ping', { clientTs: 0 }, { roomId: TUTORIAL_ROOM_ID }),
    )

    expect(received).toEqual([])
  })
})
