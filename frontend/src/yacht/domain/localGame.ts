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

/**
 * 서버 없이 도는 1인 야추판. 연습 모드(tutorialGame)가 쓰던 가짜 서버를 모드가 갈아 끼울 수
 * 있게 벌려 놓은 것이다 — 변형 룰 모드(레버리지·209·210)는 화면을 새로 그리는 게 아니라
 * **주사위를 정하는 방법**과 **점수를 매기는 방법**만 다르다. 그 둘만 주면 나머지(실서버
 * 계약대로의 broadcast·hold_changed·score.update·round.start·game.over)는 여기가 맡는다.
 *
 * 추상화는 여기까지다. 모드가 규칙 이상으로 달라지면 이 파일을 늘리지 말고 복제해라 —
 * 모드 하나를 위한 옵션이 늘어나는 순간 세 모드가 서로의 분기를 밟는다.
 */
export interface LocalYachtMode {
  playerId: string
  roomId: string
  /** 이번 굴림의 눈. 킵한 자리를 남기는 것도 모드 몫이다(연습은 대본, 레버리지는 시드 난수). */
  roll: (input: {
    held: readonly boolean[]
    previous: DiceSet | null
    rollCount: number
    roundNumber: number
  }) => DiceSet
  /**
   * 기록 점수. 기본은 일반 룰(scoreCategory)이다. 변형 룰은 여기서 감싼다 —
   * scoring.ts는 서버와 공유하는 SSOT라 모드가 건드리지 않는다.
   */
  score?: (input: {
    category: YachtCategory
    dice: DiceSet
    roundNumber: number
    used: YachtCategory[]
  }) => number
  /**
   * 몇 라운드짜리 판인가. 주면 기록할 때마다 다음 라운드를 열고 마지막 라운드 뒤에 game.over를
   * 보낸다. 없으면 라운드를 넘기지 않는다 — 연습 모드처럼 한 턴만 보여 주는 판이다.
   */
  rounds?: number
}

/** 로컬 판에는 마감이 없다. 혼자 하는 판에서 시간이 몰아붙일 이유가 없다. */
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

/** 로컬 판 한 벌. 화면을 나갔다 들어오면 새로 만들어 처음부터 시작한다. */
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

        // 기록이 곧 턴 종료다(혼자 하는 판이라 기다릴 상대가 없다).
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
      // 로컬 판에는 하트비트를 받아 줄 서버가 없다. 조용히 삼킨다(strict면 던진다).
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

/**
 * 서버 메시지 봉투. mocks의 같은 헬퍼는 MSW 전용 번들이라 여기서 끌어오지 않는다 —
 * 로컬 모드는 프로덕션에 실려 나가야 한다.
 */
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
