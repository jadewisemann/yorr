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
      // 로컬 판(튜토리얼·레버리지)에는 서버 시계가 없다. 예전에는 1시간짜리 가짜 마감을
      // 넣어 헤더에 "59:45"가 떠 있었다 — 계약이 null을 받게 된 지금은 그대로 없다고 적는다.
      roundDeadline: null,
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
        const { roundNumber } = message.payload
        board = scoredBoard(mode, board, message.payload)
        dice = null
        return [
          serverMessage(
            'game.yacht_dice.score.update',
            { playerId, scoreboard: board },
            { roomId, msgId: message.msgId },
          ),
          ...afterSubmitMessages(mode, roundNumber, board.total),
        ]
      },
      'sys.ping': () => [],
    },
  })
}

/** 제출한 칸을 채운 새 점수판. mode.score가 있으면 그 점수를, 없으면 규칙대로 계산한다. */
function scoredBoard(
  mode: LocalYachtMode,
  board: ScoreBoard,
  submission: { category: YachtCategory; dice: DiceSet; roundNumber: number },
): ScoreBoard {
  const { category, dice, roundNumber } = submission
  const score =
    mode.score?.({ category, dice, roundNumber, used: recordedCategories(board) }) ??
    scoreCategory(dice, category)
  const categories = { ...board.categories, [category]: score }
  const summary = calculateScoreSummary(recordedOnly(categories))
  return {
    categories,
    upperSubtotal: summary.upperSubtotal,
    upperBonus: summary.upperBonus,
    total: summary.total,
  }
}

/**
 * 기록 뒤에 이어지는 진행 메시지. 라운드 수가 정해진 판(레버리지)만 다음 라운드를 열거나
 * 끝낸다 — 튜토리얼처럼 정하지 않은 판은 점수 기록에서 멈춘다.
 */
function afterSubmitMessages(
  { playerId, roomId, rounds }: LocalYachtMode,
  roundNumber: number,
  total: number,
): ServerMessage[] {
  if (rounds === undefined) return []
  if (roundNumber < rounds) {
    return [
      serverMessage(
        'game.yacht_dice.round.start',
        {
          roundNumber: roundNumber + 1,
          deadline: null,
          activePlayerId: playerId,
          turnOrder: [playerId],
        },
        { roomId },
      ),
    ]
  }
  return [
    serverMessage(
      'game.yacht_dice.game.over',
      { rankings: [{ rank: 1, playerId, total }] },
      { roomId },
    ),
  ]
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
