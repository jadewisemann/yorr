import { type FakeMessageHandlers, FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import { type ServerMessage, WS_PROTOCOL_VERSION } from '@/realtime/wsEvents'
import { creatorSession, participantSession, serverMessage } from './fixtures'
import type { RealtimeContext, RealtimeFixtureOptions } from './realtime/context'
import { createRealtimeHandlers } from './realtime/handlers'

export type {
  MockRealtimeScenario,
  MockSessionRole,
  RealtimeFixtureOptions,
} from './realtime/context'

export function createRealtimeFixture(options: RealtimeFixtureOptions = {}) {
  const role = options.role ?? 'creator'
  const scenario = options.scenario ?? 'success'
  const session = role === 'creator' ? creatorSession : participantSession
  const context: RealtimeContext = {
    role,
    scenario,
    session,
    serverDice: [1, 2, 3, 4, 5],
    chatSequence: 0,
  }

  return new FakeRealtimeClient({
    connectionMessages: [connectedMessage()],
    handlers: duplicateMessages(createRealtimeHandlers(context), scenario === 'duplicate'),
    delayMs: scenario === 'delay' ? (options.delayMs ?? 300) : 0,
    strict: true,
  })
}

/** 접속 직후 서버가 보내는 첫 메시지. 재접속 경로도 이 heartbeat 주기를 따른다. */
function connectedMessage() {
  return serverMessage('sys.connected', {
    serverTs: 1_753_000_000_000,
    protocolVersion: WS_PROTOCOL_VERSION,
    heartbeatIntervalMs: 15_000,
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
