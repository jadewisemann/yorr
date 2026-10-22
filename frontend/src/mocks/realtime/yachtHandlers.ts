import type { FakeMessageHandlers } from '@/realtime/fakeRealtimeClient'
import type { DiceSet, ScoreBoard, ServerMessage } from '@/realtime/wsEvents'
import { type CategoryScores, calculateScoreSummary, scoreCategory } from '@/yacht/domain/scoring'
import { MOCK_ROOM_ID, playingRoomSnapshot, serverMessage } from '../fixtures'
import { loadMockRoomSnapshot, saveMockRoomSnapshot } from '../mockRoomState'
import type { RealtimeContext } from './context'

const MOCK_ROLL: DiceSet = [6, 5, 4, 3, 2]

/** 야추 주사위 굴림·흔들기·던지기·유지·라운드 제출. */
export function yachtHandlers(context: RealtimeContext): FakeMessageHandlers {
  return {
    'game.yacht_dice.dice.roll': (message) => {
      context.serverDice = MOCK_ROLL.map((value, index) =>
        message.payload.held[index] ? context.serverDice[index] : value,
      ) as unknown as DiceSet
      return [
        serverMessage(
          'game.yacht_dice.dice.broadcast',
          {
            playerId: context.session.you,
            roundNumber: message.payload.roundNumber,
            rollCount: message.payload.rollCount,
            dice: context.serverDice,
            held: message.payload.held,
          },
          { roomId: MOCK_ROOM_ID, msgId: message.msgId },
        ),
      ]
    },
    'game.yacht_dice.dice.shake': (message) => [
      serverMessage(
        'game.yacht_dice.dice.shaken',
        {
          playerId: context.session.you,
          roundNumber: message.payload.roundNumber,
          direction: message.payload.direction,
          strength: message.payload.strength,
        },
        { roomId: MOCK_ROOM_ID, msgId: message.msgId },
      ),
    ],
    'game.yacht_dice.dice.throw': (message) => [
      serverMessage(
        'game.yacht_dice.dice.thrown',
        {
          playerId: context.session.you,
          rollCount: message.payload.rollCount,
          roundNumber: message.payload.roundNumber,
        },
        { roomId: MOCK_ROOM_ID, msgId: message.msgId },
      ),
    ],
    'game.yacht_dice.dice.hold': (message) => [
      serverMessage(
        'game.yacht_dice.dice.hold_changed',
        {
          held: message.payload.held,
          playerId: context.session.you,
          roundNumber: message.payload.roundNumber,
        },
        { roomId: MOCK_ROOM_ID, msgId: message.msgId },
      ),
    ],
    'game.yacht_dice.round.submit': (message) => submitRound(message, context),
  }
}

type SubmitMessage = Parameters<NonNullable<FakeMessageHandlers['game.yacht_dice.round.submit']>>[0]

function submitRound(message: SubmitMessage, context: RealtimeContext) {
  const you = context.session.you
  const stored = loadMockRoomSnapshot()
  const scoreboard = stored?.game?.scores[you] ?? playingRoomSnapshot.game?.scores[you]
  if (!scoreboard) return []

  const updatedScoreboard = applyCategory(
    scoreboard,
    message.payload.dice,
    message.payload.category,
  )
  if (stored?.game) persistScoreboard(you, updatedScoreboard)
  const scoreUpdate = scoreUpdateMessage(message, you, updatedScoreboard)
  const roundEnd = serverMessage(
    'game.yacht_dice.round.end',
    { roundNumber: message.payload.roundNumber, submitted: [you] },
    { roomId: MOCK_ROOM_ID },
  )
  // 역순 내성 시나리오는 점수 갱신보다 라운드 종료를 먼저 보낸다.
  return context.scenario === 'out-of-order' ? [roundEnd, scoreUpdate] : [scoreUpdate, roundEnd]
}

/** 제출한 카테고리를 저장된 방 스냅샷에 반영한다(진행 중인 방일 때만). */
function persistScoreboard(playerId: string, scoreboard: ScoreBoard) {
  const stored = loadMockRoomSnapshot()
  if (!stored?.game) return
  saveMockRoomSnapshot({
    ...stored,
    game: {
      ...stored.game,
      scores: { ...stored.game.scores, [playerId]: scoreboard },
    },
  })
}

function scoreUpdateMessage(
  message: SubmitMessage,
  playerId: string,
  scoreboard: ScoreBoard,
): ServerMessage {
  return serverMessage(
    'game.yacht_dice.score.update',
    { playerId, scoreboard },
    { roomId: MOCK_ROOM_ID, msgId: message.msgId },
  )
}

function applyCategory(
  scoreboard: ScoreBoard,
  dice: DiceSet,
  category: SubmitMessage['payload']['category'],
): ScoreBoard {
  const categories = {
    ...scoreboard.categories,
    [category]: scoreCategory(dice, category),
  }
  const summary = calculateScoreSummary(toRecordedScores(categories))
  return {
    categories,
    upperSubtotal: summary.upperSubtotal,
    upperBonus: summary.upperBonus,
    total: summary.total,
  }
}

function toRecordedScores(categories: ScoreBoard['categories']): CategoryScores {
  return Object.fromEntries(
    Object.entries(categories).filter(([, score]) => score !== null),
  ) as CategoryScores
}
