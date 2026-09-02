import { describe, expect, it } from 'vitest'
import type { ServerMessage } from '@/realtime/wsEvents'
import { buildClientMessage } from '@/realtime/wsEvents'
import type { DiceSet } from '@/yacht/domain/dice'
import { pickLeverageCategory } from '@/yacht/domain/leverage'
import {
  createLeverageClient,
  LEVERAGE_PLAYER_ID,
  LEVERAGE_ROOM_ID,
  LEVERAGE_ROUNDS,
} from '@/yacht/domain/leverageGame'
import { scoreCategory, type YachtCategory } from '@/yacht/domain/scoring'
import { rollLocalDice } from './localRoll'

const SEED = 20260805
const YACHT_DICE: DiceSet = [5, 5, 5, 5, 5]

function submit(
  client: ReturnType<typeof createLeverageClient>,
  roundNumber: number,
  category: YachtCategory,
  dice: DiceSet = YACHT_DICE,
) {
  const received: ServerMessage[] = []
  const stop = client.onMessage((message) => received.push(message))
  client.send(
    buildClientMessage(
      'game.yacht_dice.round.submit',
      { category, dice, roundNumber },
      { roomId: LEVERAGE_ROOM_ID },
    ),
  )
  stop()
  return received
}

function boardOf(messages: ServerMessage[]) {
  const update = messages.find((message) => message.type === 'game.yacht_dice.score.update')
  if (update?.type !== 'game.yacht_dice.score.update') throw new Error('score.update가 없다')
  return update.payload.scoreboard
}

describe('레버리지 로컬 판', () => {
  it('레버리지 족보에 기록하면 2배로 들어간다 — 12라운드 전부', () => {
    let doubledPoints = 0

    for (let round = 1; round <= LEVERAGE_ROUNDS; round += 1) {
      const leveraged = pickLeverageCategory(SEED, round)
      if (leveraged === null) throw new Error(`${round}라운드에 뽑힌 족보가 없다`)
      const board = boardOf(submit(createLeverageClient(SEED), round, leveraged))

      expect(board.categories[leveraged]).toBe(scoreCategory(YACHT_DICE, leveraged) * 2)
      doubledPoints += board.categories[leveraged] ?? 0
    }

    expect(doubledPoints).toBeGreaterThan(0)
  })

  it('뽑히지 않은 족보는 일반 점수 그대로다', () => {
    const leveraged = pickLeverageCategory(SEED, 1)
    const other = (['yacht', 'choice'] as const).find((category) => category !== leveraged)
    if (!other) throw new Error('비교할 족보가 없다')

    const board = boardOf(submit(createLeverageClient(SEED), 1, other))

    expect(board.categories[other]).toBe(scoreCategory(YACHT_DICE, other))
  })

  it('기록할 때마다 다음 라운드가 열리고, 마지막 라운드 뒤에는 게임이 끝난다', () => {
    const client = createLeverageClient(SEED)

    const next = submit(client, 1, 'ones')
    expect(next.map((message) => message.type)).toEqual([
      'game.yacht_dice.score.update',
      'game.yacht_dice.round.start',
    ])

    const last = submit(client, LEVERAGE_ROUNDS, 'twos')
    const over = last.find((message) => message.type === 'game.yacht_dice.game.over')
    if (over?.type !== 'game.yacht_dice.game.over') throw new Error('game.over가 없다')
    expect(over.payload.rankings[0]?.playerId).toBe(LEVERAGE_PLAYER_ID)
  })

  it('굴림은 시드 결정론이다 — 같은 시드면 같은 눈이 나온다', () => {
    const roll = (client: ReturnType<typeof createLeverageClient>) =>
      rollLocalDice(client, {
        held: [false, false, false, false, false],
        rollCount: 1,
        roomId: LEVERAGE_ROOM_ID,
      })

    expect(roll(createLeverageClient(SEED))).toEqual(roll(createLeverageClient(SEED)))
  })
})
