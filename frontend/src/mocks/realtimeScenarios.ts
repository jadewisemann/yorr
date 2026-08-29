import { type FakeMessageHandlers, FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import {
  type DiceSet,
  type ScoreBoard,
  type ServerMessage,
  WS_PROTOCOL_VERSION,
} from '@/realtime/wsEvents'
import { type CategoryScores, calculateScoreSummary, scoreCategory } from '@/yacht/domain/scoring'
import {
  creatorSession,
  dashboardSession,
  MOCK_ROOM_ID,
  MOCK_ROUND_DURATION_MS,
  participantSession,
  playingRoomSnapshot,
  serverMessage,
} from './fixtures'
import { loadMockRoomSnapshot, saveMockRoomSnapshot } from './mockRoomState'

export type MockRealtimeScenario =
  | 'success'
  | 'delay'
  | 'error'
  | 'duplicate'
  | 'out-of-order'
  | 'reconnect'

export type MockSessionRole = 'creator' | 'participant'

export interface RealtimeFixtureOptions {
  role?: MockSessionRole
  scenario?: MockRealtimeScenario
  delayMs?: number
}

export function createRealtimeFixture(options: RealtimeFixtureOptions = {}) {
  const role = options.role ?? 'creator'
  const scenario = options.scenario ?? 'success'
  const session = role === 'creator' ? creatorSession : participantSession
  const connected = serverMessage('sys.connected', {
    serverTs: 1_753_000_000_000,
    protocolVersion: WS_PROTOCOL_VERSION,
    heartbeatIntervalMs: 15_000,
  })
  let serverDice: DiceSet = [1, 2, 3, 4, 5]
  let chatSequence = 0

  const handlers: FakeMessageHandlers = {
    'sys.ping': (message) => [
      serverMessage(
        'sys.pong',
        { serverTs: message.payload.clientTs + 1 },
        { msgId: message.msgId },
      ),
    ],
    'sys.reconnect': () => [
      serverMessage('sys.reconnected', { snapshot: playingRoomSnapshot }, { roomId: MOCK_ROOM_ID }),
    ],
    'room.join': (message) => {
      if (scenario === 'error') {
        return [
          serverMessage('error', {
            code: 'ROOM_FULL',
            message: '방 정원이 가득 찼습니다.',
            ...(message.msgId === undefined ? {} : { refMsgId: message.msgId }),
          }),
        ]
      }

      const joinedSession =
        message.payload.sessionToken === participantSession.sessionToken
          ? participantSession
          : message.payload.sessionToken === dashboardSession.sessionToken
            ? dashboardSession
            : session

      const stored = loadMockRoomSnapshot()
      const snapshot = stored?.game
        ? {
            ...stored,
            game: { ...stored.game, roundDeadline: Date.now() + MOCK_ROUND_DURATION_MS },
          }
        : (stored ?? joinedSession.snapshot)

      return [
        serverMessage(
          'room.joined',
          {
            you: joinedSession.you,
            sessionToken: joinedSession.sessionToken,
            snapshot,
          },
          { roomId: joinedSession.roomId, msgId: message.msgId },
        ),
      ]
    },
    /*
     * 채팅은 mock에서도 **되돌려 준다**. 서버가 하는 일이 중계뿐이라(wsEvents.ts의 chat 절)
     * 보낸 말을 그대로 방송하면 실제 서버와 같은 흐름이 되고, 이것이 없으면 strict 모드가
     * 던져 mock으로 도는 화면에서 채팅이 아무 반응 없이 사라진다.
     */
    /*
     * 컨트롤러 링크 시그널링은 mock에서 **아무것도 돌려주지 않는다.** 상대 브라우저가 없어서
     * 협상이 성립할 수 없고, 그러면 링크가 안 열려 연출 릴레이가 WebSocket으로 폴백한다 —
     * 그것이 mock으로 도는 화면에서 원하는 동작이다(controller-link.md 「폴백 규칙」).
     * 핸들러를 비워 두는 대신 명시적으로 등록하는 이유는 strict 모드가 던지지 않게 하려는
     * 것이고, 던지지 않아야 "상대가 없으면 조용히 버린다"는 서버 동작과 같아진다.
     */
    'ctrl.signal': () => [],
    'chat.send': (message) => {
      chatSequence += 1
      return [
        serverMessage(
          'chat.message',
          {
            messageId: `mock-chat-${chatSequence}`,
            playerId: session.you,
            nickname: session.nickname,
            text: message.payload.text,
            at: Date.now(),
          },
          { roomId: MOCK_ROOM_ID },
        ),
      ]
    },
    'room.ready': (message) => [
      serverMessage(
        'room.ready_changed',
        { playerId: session.you, ready: message.payload.ready },
        { roomId: MOCK_ROOM_ID, msgId: message.msgId },
      ),
    ],
    'game.yacht_dice.dice.roll': (message) => {
      const rolled: DiceSet = [6, 5, 4, 3, 2]
      serverDice = rolled.map((value, index) =>
        message.payload.held[index] ? serverDice[index] : value,
      ) as unknown as DiceSet
      return [
        serverMessage(
          'game.yacht_dice.dice.broadcast',
          {
            playerId: session.you,
            roundNumber: message.payload.roundNumber,
            rollCount: message.payload.rollCount,
            dice: serverDice,
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
          playerId: session.you,
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
          playerId: session.you,
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
          playerId: session.you,
          roundNumber: message.payload.roundNumber,
        },
        { roomId: MOCK_ROOM_ID, msgId: message.msgId },
      ),
    ],
    'game.yacht_dice.round.submit': (message) => {
      const stored = loadMockRoomSnapshot()
      const scoreboard =
        stored?.game?.scores[session.you] ?? playingRoomSnapshot.game?.scores[session.you]
      if (!scoreboard) return []

      const categories = {
        ...scoreboard.categories,
        [message.payload.category]: scoreCategory(message.payload.dice, message.payload.category),
      }
      const summary = calculateScoreSummary(toRecordedScores(categories))
      const updatedScoreboard: ScoreBoard = {
        categories,
        upperSubtotal: summary.upperSubtotal,
        upperBonus: summary.upperBonus,
        total: summary.total,
      }

      if (stored?.game) {
        saveMockRoomSnapshot({
          ...stored,
          game: {
            ...stored.game,
            scores: { ...stored.game.scores, [session.you]: updatedScoreboard },
          },
        })
      }
      const scoreUpdate = serverMessage(
        'game.yacht_dice.score.update',
        { playerId: session.you, scoreboard: updatedScoreboard },
        { roomId: MOCK_ROOM_ID, msgId: message.msgId },
      )
      const roundEnd = serverMessage(
        'game.yacht_dice.round.end',
        { roundNumber: message.payload.roundNumber, submitted: [session.you] },
        { roomId: MOCK_ROOM_ID },
      )
      return scenario === 'out-of-order' ? [roundEnd, scoreUpdate] : [scoreUpdate, roundEnd]
    },
  }

  return new FakeRealtimeClient({
    connectionMessages: [connected],
    handlers: duplicateMessages(handlers, scenario === 'duplicate'),
    delayMs: scenario === 'delay' ? (options.delayMs ?? 300) : 0,
    strict: true,
  })
}

function toRecordedScores(categories: ScoreBoard['categories']): CategoryScores {
  return Object.fromEntries(
    Object.entries(categories).filter(([, score]) => score !== null),
  ) as CategoryScores
}

function duplicateMessages(handlers: FakeMessageHandlers, duplicate: boolean): FakeMessageHandlers {
  if (!duplicate) return handlers

  return Object.fromEntries(
    Object.entries(handlers).map(([type, handler]) => [
      type,
      (message: never) => {
        const messages = (handler as (value: never) => ServerMessage[])(message)
        return messages.flatMap((item) => [item, item])
      },
    ]),
  ) as FakeMessageHandlers
}
