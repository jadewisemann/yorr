import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import type { DiceSet, RoomSnapshot, ScoreBoard, ServerMessage } from '@/realtime/wsEvents'
import { WS_PROTOCOL_VERSION } from '@/realtime/wsEvents'
import type { ActiveRoomSession } from '@/store'
import {
  type CategoryScores,
  calculateScoreSummary,
  scoreCategory,
  YACHT_CATEGORIES,
  type YachtCategory,
} from '@/yacht/domain/scoring'

export interface LocalYachtMode {
  playerId: string
  roomId: string
  roll: (input: {
    held: readonly boolean[]
    previous: DiceSet | null
    rollCount: number
    roundNumber: number
  }) => DiceSet
  score?: (input: {
    category: YachtCategory
    dice: DiceSet
    roundNumber: number
    used: YachtCategory[]
  }) => number
  rounds?: number
}

export const LOCAL_ROUND_MS = 60 * 60 * 1000

export function createEmptyBoard(): ScoreBoard {
  return {
    categories: Object.fromEntries(
      YACHT_CATEGORIES.map((category) => [category, null]),
    ) as ScoreBoard['categories'],
    upperSubtotal: 0,
    upperBonus: 0,
    total: 0,
  }
}

export function createLocalSession(options: {
  nickname?: string
  playerId: string
  roomCode: string
  roomId: string
}): ActiveRoomSession {
  return {
    gameId: null,
    roomId: options.roomId,
    roomCode: options.roomCode,
    nickname: options.nickname ?? '나',
    membershipRole: 'host',
    sessionToken: `${options.roomId}-session`,
    you: options.playerId,
  }
}

export function createLocalSnapshot(options: {
  nickname?: string
  playerId: string
  roomId: string
}): RoomSnapshot {
  const nickname = options.nickname ?? '나'
  return {
    roomId: options.roomId,
    phase: 'playing',
    players: [{ playerId: options.playerId, nickname, status: 'online' }],
    game: {
      roundNumber: 1,
      activePlayerId: options.playerId,
      roundDeadline: Date.now() + LOCAL_ROUND_MS,
      scores: { [options.playerId]: createEmptyBoard() },
      turnOrder: [options.playerId],
      rollCount: 0,
    },
  }
}

export function createLocalYachtClient(mode: LocalYachtMode) {
  const { playerId, roomId } = mode
  let dice: DiceSet | null = null
  let board = createEmptyBoard()

  return new FakeRealtimeClient({
    connectionMessages: [
      serverMessage('sys.connected', {
        serverTs: Date.now(),
        protocolVersion: WS_PROTOCOL_VERSION,
        heartbeatIntervalMs: 15_000,
      }),
    ],
    handlers: {
      'game.yacht_dice.dice.roll': (message) => {
        dice = mode.roll({
          held: message.payload.held,
          previous: dice,
          rollCount: message.payload.rollCount,
          roundNumber: message.payload.roundNumber,
        })
        return [
          serverMessage(
            'game.yacht_dice.dice.broadcast',
            {
              playerId,
              roundNumber: message.payload.roundNumber,
              rollCount: message.payload.rollCount,
              dice,
              held: message.payload.held,
            },
            { roomId, msgId: message.msgId },
          ),
        ]
      },
      'game.yacht_dice.dice.hold': (message) => [
        serverMessage(
          'game.yacht_dice.dice.hold_changed',
          {
            held: message.payload.held,
            playerId,
            roundNumber: message.payload.roundNumber,
          },
          { roomId, msgId: message.msgId },
        ),
      ],
      'game.yacht_dice.round.submit': (message) => {
        const { category, dice: submitted, roundNumber } = message.payload
        const score =
          mode.score?.({
            category,
            dice: submitted,
            roundNumber,
            used: recordedCategories(board),
          }) ?? scoreCategory(submitted, category)
        const categories = { ...board.categories, [category]: score }
        const summary = calculateScoreSummary(recordedOnly(categories))
        board = {
          categories,
          upperSubtotal: summary.upperSubtotal,
          upperBonus: summary.upperBonus,
          total: summary.total,
        }
        dice = null

        const replies: ServerMessage[] = [
          serverMessage(
            'game.yacht_dice.score.update',
            { playerId, scoreboard: board },
            { roomId, msgId: message.msgId },
          ),
        ]
        if (mode.rounds === undefined) return replies

        if (roundNumber < mode.rounds) {
          replies.push(
            serverMessage(
              'game.yacht_dice.round.start',
              {
                roundNumber: roundNumber + 1,
                deadline: Date.now() + LOCAL_ROUND_MS,
                activePlayerId: playerId,
                turnOrder: [playerId],
              },
              { roomId },
            ),
          )
          return replies
        }
        replies.push(
          serverMessage(
            'game.yacht_dice.game.over',
            { rankings: [{ rank: 1, playerId, total: board.total }] },
            { roomId },
          ),
        )
        return replies
      },
      'sys.ping': () => [],
    },
  })
}

function recordedCategories(board: ScoreBoard): YachtCategory[] {
  return YACHT_CATEGORIES.filter((category) => board.categories[category] !== null)
}

function recordedOnly(categories: ScoreBoard['categories']): CategoryScores {
  return Object.fromEntries(
    Object.entries(categories).filter(([, score]) => score !== null),
  ) as CategoryScores
}

export function serverMessage<T extends ServerMessage['type']>(
  type: T,
  payload: Extract<ServerMessage, { type: T }>['payload'],
  options: { msgId?: string | undefined; roomId?: string | undefined } = {},
): Extract<ServerMessage, { type: T }> {
  return {
    type,
    ts: Date.now(),
    payload,
    ...(options.roomId === undefined ? {} : { roomId: options.roomId }),
    ...(options.msgId === undefined ? {} : { msgId: options.msgId }),
  } as Extract<ServerMessage, { type: T }>
}
