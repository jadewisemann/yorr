import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import type { DiceSet, RoomSnapshot, ScoreBoard, ServerMessage } from '@/realtime/wsEvents'
import { WS_PROTOCOL_VERSION } from '@/realtime/wsEvents'
import type { ActiveRoomSession } from '@/store'
import {
  type CategoryScores,
  calculateScoreSummary,
  scoreCategory,
  YACHT_CATEGORIES,
} from '@/yacht/domain/scoring'

/**
 * 연습 모드는 방도 상대도 없다. 실제 게임 화면(GamePlay)을 그대로 띄우되 서버 자리에
 * 이 모듈이 들어간다 — 화면을 따로 만들면 "연습에서 본 것"과 "실전에서 만나는 것"이
 * 갈라지고, 그 차이가 곧 튜토리얼이 못 가르친 부분이 된다.
 *
 * 실서버 계약(dice.broadcast · dice.hold_changed · score.update)을 그대로 지키므로
 * GamePlay 쪽에는 연습용 분기가 하나도 없다.
 */
export const TUTORIAL_ROOM_ID = 'tutorial'
export const TUTORIAL_PLAYER_ID = 'tutorial-player'
/** 연습에는 마감이 없다. 배우는 중에 시간이 몰아붙이면 안 된다. */
const TUTORIAL_ROUND_MS = 60 * 60 * 1000

export const tutorialSession: ActiveRoomSession = {
  gameId: null,
  roomId: TUTORIAL_ROOM_ID,
  roomCode: 'TUTORIAL',
  nickname: '나',
  membershipRole: 'host',
  sessionToken: 'tutorial-session',
  you: TUTORIAL_PLAYER_ID,
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

export function createTutorialSnapshot(): RoomSnapshot {
  return {
    roomId: TUTORIAL_ROOM_ID,
    phase: 'playing',
    players: [{ playerId: TUTORIAL_PLAYER_ID, nickname: '나', status: 'online' }],
    game: {
      roundNumber: 1,
      activePlayerId: TUTORIAL_PLAYER_ID,
      roundDeadline: Date.now() + TUTORIAL_ROUND_MS,
      scores: { [TUTORIAL_PLAYER_ID]: createEmptyBoard() },
      turnOrder: [TUTORIAL_PLAYER_ID],
      rollCount: 0,
    },
  }
}

/**
 * 연습 굴림은 결과를 미리 정해 둔다. 주사위 눈은 어차피 서버가 정하므로 연습에서는 가르치기
 * 좋은 쪽으로 고른다 — 무작위로 두면 "6 두 개를 킵해 보세요" 같은 구체적인 안내를 할 수 없고,
 * 운이 나쁘면 아무것도 배우지 못한 채 한 턴이 끝난다.
 *
 * 6이 두 개 → 세 개 → 네 개로 불어나므로, 킵이 왜 이득인지가 숫자로 그대로 보인다.
 */
const SCRIPTED_ROLLS: DiceSet[] = [
  [6, 6, 2, 3, 5],
  [6, 6, 6, 4, 1],
  [6, 6, 6, 6, 2],
]

/**
 * 킵한 자리는 그대로 두고 나머지만 대본 값으로 채운다. 사용자가 안내와 다른 주사위를 킵해도
 * 흐름이 깨지지 않는다 — 대본이 뒤로 갈수록 6이 많아지므로 어느 쪽을 킵하든 6은 늘어난다.
 */
function rollDice(held: readonly boolean[], previous: DiceSet | null, rollCount: number): DiceSet {
  const scripted = SCRIPTED_ROLLS[Math.min(rollCount, SCRIPTED_ROLLS.length) - 1]
  if (!scripted) throw new Error(`연습 굴림 ${rollCount}의 대본이 없습니다`)
  return Array.from({ length: 5 }, (_, index) =>
    held[index] && previous ? previous[index] : scripted[index],
  ) as unknown as DiceSet
}

/** 연습판 한 벌. 화면을 나갔다 들어오면 새로 만들어 처음부터 시작한다. */
export function createTutorialClient() {
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
        dice = rollDice(message.payload.held, dice, message.payload.rollCount)
        return [
          serverMessage(
            'game.yacht_dice.dice.broadcast',
            {
              playerId: TUTORIAL_PLAYER_ID,
              roundNumber: message.payload.roundNumber,
              rollCount: message.payload.rollCount,
              dice,
              held: message.payload.held,
            },
            { roomId: TUTORIAL_ROOM_ID, msgId: message.msgId },
          ),
        ]
      },
      'game.yacht_dice.dice.hold': (message) => [
        serverMessage(
          'game.yacht_dice.dice.hold_changed',
          {
            held: message.payload.held,
            playerId: TUTORIAL_PLAYER_ID,
            roundNumber: message.payload.roundNumber,
          },
          { roomId: TUTORIAL_ROOM_ID, msgId: message.msgId },
        ),
      ],
      'game.yacht_dice.round.submit': (message) => {
        const categories = {
          ...board.categories,
          [message.payload.category]: scoreCategory(message.payload.dice, message.payload.category),
        }
        const summary = calculateScoreSummary(recordedOnly(categories))
        board = {
          categories,
          upperSubtotal: summary.upperSubtotal,
          upperBonus: summary.upperBonus,
          total: summary.total,
        }
        return [
          serverMessage(
            'game.yacht_dice.score.update',
            { playerId: TUTORIAL_PLAYER_ID, scoreboard: board },
            { roomId: TUTORIAL_ROOM_ID, msgId: message.msgId },
          ),
        ]
      },
      // 연습에는 하트비트를 받아 줄 서버가 없다. 조용히 삼킨다(strict면 던진다).
      'sys.ping': () => [],
    },
  })
}

function recordedOnly(categories: ScoreBoard['categories']): CategoryScores {
  return Object.fromEntries(
    Object.entries(categories).filter(([, score]) => score !== null),
  ) as CategoryScores
}

/**
 * 서버 메시지 봉투. mocks의 같은 헬퍼는 MSW 전용 번들이라 여기서 끌어오지 않는다 —
 * 연습 모드는 프로덕션에 실려 나가야 한다.
 */
function serverMessage<T extends ServerMessage['type']>(
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
