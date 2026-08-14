import { describe, expect, it } from 'vitest'
import { DomainError } from '../../../errors.js'
import type { InboundEnvelope } from '../../../ws/envelope.js'
import type { WsRoomSnapshot } from '../../../ws/protocol.js'
import { type ClientSocket, SOCKET_OPEN } from '../../../ws/socket.js'
import { GameModuleRegistry } from '../../module.js'
import { PingPongGameModule, type PingPongSocketMembership } from '../pingPongGameModule.js'
import type { PingPongGameService } from '../pingPongGameService.js'

/**
 * 모듈 계층의 계약: 라우팅(`swing`·`ready`만) · 멤버십/roomId 검증 ·
 * **오류 응답을 스스로 보내기**(게이트웨이는 예외를 삼킨다).
 *
 * Java에서는 `GameWebSocketHandlerTest`가 이 경계를 덮었지만 우리 쪽 라우팅은
 * `GameModuleRegistry.dispatch`가 하므로 여기서 모듈과 함께 고정한다.
 */
const ROOM = 'room-a'
const PLAYER = 'player-1'

interface Recorded {
  readonly kind: 'swing' | 'ready'
  readonly playerId: string
  readonly payload?: unknown
}

const moduleUnderTest = (
  options: {
    readonly throws?: unknown
    readonly member?: { playerId: string; roomId: string } | null
  } = {},
): {
  readonly module: PingPongGameModule
  readonly socket: FakeSocket
  readonly recorded: Recorded[]
} => {
  const recorded: Recorded[] = []
  const socket = fakeSocket()
  const games = {
    ready: async (_roomId: string, playerId: string) => {
      if (options.throws !== undefined) throw options.throws
      recorded.push({ kind: 'ready', playerId })
    },
    swing: async (_roomId: string, playerId: string, payload: unknown) => {
      if (options.throws !== undefined) throw options.throws
      recorded.push({ kind: 'swing', playerId, payload })
    },
  } as unknown as PingPongGameService<WsRoomSnapshot>
  const sessions: PingPongSocketMembership = {
    of: () => (options.member === undefined ? { playerId: PLAYER, roomId: ROOM } : options.member),
  }
  return { module: new PingPongGameModule(games, sessions), socket, recorded }
}

const inbound = (type: string, payload: unknown, roomId = ROOM): InboundEnvelope => ({
  type,
  ts: 1,
  payload,
  roomId,
  msgId: 'm-1',
})

describe('PingPongGameModule', () => {
  it('swing·ready만 처리하고 다른 이벤트는 넘기지 않는다', () => {
    const { module } = moduleUnderTest()

    expect(module.handles('swing')).toBe(true)
    expect(module.handles('ready')).toBe(true)
    expect(module.handles('dice.roll')).toBe(false)
    expect(module.handles('game.ping_pong.swing')).toBe(false)
  })

  it('레지스트리가 게임 네임스페이스를 벗겨 모듈로 넘긴다', async () => {
    const { module, socket, recorded } = moduleUnderTest()
    const registry = new GameModuleRegistry()
    registry.register(module)

    const handled = await registry.dispatch(
      'PING_PONG',
      socket,
      inbound('game.ping_pong.swing', { inputSeq: 3, clientTs: 9 }),
    )

    expect(handled).toBe(true)
    expect(recorded).toEqual([
      { kind: 'swing', playerId: PLAYER, payload: { inputSeq: 3, clientTs: 9 } },
    ])
    // 다른 게임 네임스페이스는 거부된다.
    expect(await registry.dispatch('PING_PONG', socket, inbound('game.duel.shoot', {}))).toBe(false)
  })

  it('없는 필드는 0으로 관용한다(Java record 바인딩과 같음)', async () => {
    const { module, socket, recorded } = moduleUnderTest()

    await module.handle(socket, inbound('swing', {}))

    expect(recorded).toEqual([
      { kind: 'swing', playerId: PLAYER, payload: { inputSeq: 0, clientTs: 0 } },
    ])
  })

  it('좌석이 없거나 roomId가 어긋나면 NOT_IN_ROOM으로 답한다', async () => {
    const other = moduleUnderTest()
    await other.module.handle(other.socket, inbound('swing', {}, 'room-b'))
    expect(errorOf(other.socket)).toEqual({
      code: 'NOT_IN_ROOM',
      message: 'current room membership is required',
      refMsgId: 'm-1',
    })

    const seatless = moduleUnderTest({ member: null })
    await seatless.module.handle(seatless.socket, inbound('ready', {}))
    expect(errorOf(seatless.socket)?.code).toBe('NOT_IN_ROOM')
    expect(seatless.recorded).toEqual([])
  })

  it('도메인 오류는 코드를 그대로, 그 밖은 invalid swing payload로 뭉갠다', async () => {
    const domain = moduleUnderTest({ throws: new DomainError('invalid_ping_pong_swing') })
    await domain.module.handle(domain.socket, inbound('swing', { inputSeq: -1, clientTs: 0 }))
    expect(errorOf(domain.socket)).toEqual({
      code: 'INVALID_MESSAGE',
      message: 'invalid_ping_pong_swing',
      refMsgId: 'm-1',
    })

    // 락 경합(`game_state_busy`)·저장소 장애처럼 도메인 오류가 아닌 것은 뭉개진다(Java와 같음).
    const other = moduleUnderTest({ throws: new Error('boom') })
    await other.module.handle(other.socket, inbound('swing', { inputSeq: 1, clientTs: 0 }))
    expect(errorOf(other.socket)?.message).toBe('invalid swing payload')

    // 파싱 실패도 같은 응답이다 — 예외는 밖으로 나가지 않는다.
    const broken = moduleUnderTest()
    await broken.module.handle(broken.socket, inbound('swing', { inputSeq: 'x' }))
    expect(errorOf(broken.socket)?.message).toBe('invalid swing payload')
  })
})

interface FakeSocket extends ClientSocket {
  readonly sent: string[]
}

const fakeSocket = (): FakeSocket => ({
  readyState: SOCKET_OPEN,
  sent: [],
  send(data: string) {
    this.sent.push(data)
  },
  close() {},
})

const errorOf = (
  socket: FakeSocket,
): { code: string; message: string; refMsgId?: string } | undefined => {
  const frame = socket.sent[0]
  if (frame === undefined) return undefined
  const parsed = JSON.parse(frame) as { type: string; payload: { code: string; message: string } }
  expect(parsed.type).toBe('error')
  return parsed.payload
}
