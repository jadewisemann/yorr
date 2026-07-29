import type { FakeMessageHandlers } from '@/realtime/fakeRealtimeClient'
import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import type { DiceSet, ServerMessage } from '@/realtime/wsEvents'
import { WS_PROTOCOL_VERSION } from '@/realtime/wsEvents'
import {
  creatorSession,
  MOCK_ROOM_ID,
  participantSession,
  playingRoomSnapshot,
  scoreCandidates,
  serverMessage,
} from './fixtures'

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
          : session

      return [
        serverMessage(
          'room.joined',
          {
            you: joinedSession.you,
            sessionToken: joinedSession.sessionToken,
            snapshot: joinedSession.snapshot,
          },
          { roomId: joinedSession.roomId, msgId: message.msgId },
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
    'dice.roll': (message) => {
      const rolled: DiceSet = [6, 5, 4, 3, 2]
      serverDice = rolled.map((value, index) =>
        message.payload.held[index] ? serverDice[index] : value,
      ) as unknown as DiceSet
      return [
        serverMessage(
          'dice.broadcast',
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
    'dice.hold': (message) => [
      serverMessage(
        'dice.hold_changed',
        {
          held: message.payload.held,
          playerId: session.you,
          roundNumber: message.payload.roundNumber,
        },
        { roomId: MOCK_ROOM_ID, msgId: message.msgId },
      ),
    ],
    'round.submit': (message) => {
      const scoreboard = playingRoomSnapshot.game?.scores[session.you]
      if (!scoreboard) return []

      const updatedScoreboard = {
        ...scoreboard,
        categories: {
          ...scoreboard.categories,
          [message.payload.category]: scoreCandidates.candidates[message.payload.category],
        },
        total: scoreCandidates.candidates[message.payload.category],
      }
      const scoreUpdate = serverMessage(
        'score.update',
        { playerId: session.you, scoreboard: updatedScoreboard },
        { roomId: MOCK_ROOM_ID, msgId: message.msgId },
      )
      const roundEnd = serverMessage(
        'round.end',
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
