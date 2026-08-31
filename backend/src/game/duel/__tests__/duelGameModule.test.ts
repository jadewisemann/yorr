import { beforeEach, describe, expect, it } from 'vitest'
import { DomainError } from '../../../errors.js'
import type { InboundEnvelope } from '../../../ws/envelope.js'
import type { WsRoomSnapshot } from '../../../ws/protocol.js'
import { type ClientSocket, SOCKET_OPEN } from '../../../ws/socket.js'
import { GameModuleRegistry } from '../../module.js'
import { DuelGameModule } from '../duelGameModule.js'
import type { DuelDrawPayload, DuelGameService } from '../duelGameService.js'
import type { DuelSessionLookup } from '../duelPorts.js'

const ROOM = 'ROOM1'
const PLAYER = 'player-1'

interface FakeSocket extends ClientSocket {
  readonly sent: unknown[]
}

const fakeSocket = (): FakeSocket => {
  const sent: unknown[] = []
  return {
    readyState: SOCKET_OPEN,
    sent,
    send: (data: string) => sent.push(JSON.parse(data)),
    close: () => {},
  }
}

/** `roomId: null`은 **필드 자체가 없는** 봉투를 뜻한다(기본값은 현재 방). */
const inbound = (payload: unknown, roomId: string | null = ROOM): InboundEnvelope => ({
  type: 'draw',
  ts: 1,
  payload,
  ...(roomId === null ? {} : { roomId }),
  msgId: 'msg-1',
})

/**
 * 모듈은 라우팅·검증·오류 응답만 한다 — 판정은 규칙이, 진행은 서비스가 맡는다.
 * 결투 모듈의 draw 케이스.
 */
describe('DuelGameModule', () => {
  let draws: { roomId: string; playerId: string; payload: DuelDrawPayload }[]
  let failure: Error | null
  let module: DuelGameModule
  let socket: FakeSocket

  const errorOf = (target: FakeSocket): { code: string; message: string; refMsgId?: string } => {
    const frame = target.sent.at(-1) as { type: string; payload: Record<string, string> }
    expect(frame.type).toBe('error')
    return frame.payload as unknown as { code: string; message: string; refMsgId?: string }
  }

  beforeEach(() => {
    draws = []
    failure = null
    socket = fakeSocket()

    const games = {
      draw: async (roomId: string, playerId: string, payload: DuelDrawPayload) => {
        if (failure !== null) throw failure
        draws.push({ roomId, playerId, payload })
      },
    } as unknown as DuelGameService<WsRoomSnapshot>
    const sessions: DuelSessionLookup<ClientSocket> = {
      of: (candidate) => (candidate === socket ? { playerId: PLAYER, roomId: ROOM } : null),
    }
    module = new DuelGameModule(games, sessions)
  })

  it('draw 하나만 처리한다', () => {
    expect(module.handles('draw')).toBe(true)
    expect(module.handles('ready')).toBe(false)
    expect(module.handles('dice.roll')).toBe(false)
  })

  it('레지스트리가 game.duel.draw를 이 모듈로 보낸다', async () => {
    const registry = new GameModuleRegistry()
    registry.register(module)

    const routed = await registry.dispatch('DUEL', socket, {
      type: 'game.duel.draw',
      ts: 1,
      payload: { inputSeq: 3, reactionMs: 180 },
      roomId: ROOM,
      msgId: 'msg-1',
    })

    expect(routed).toBe(true)
    expect(draws).toEqual([
      { roomId: ROOM, playerId: PLAYER, payload: { inputSeq: 3, reactionMs: 180 } },
    ])
  })

  it('다른 게임 네임스페이스는 받지 않는다', async () => {
    const registry = new GameModuleRegistry()
    registry.register(module)

    expect(
      await registry.dispatch('DUEL', socket, {
        type: 'game.yacht_dice.draw',
        ts: 1,
        payload: { inputSeq: 1, reactionMs: 1 },
        roomId: ROOM,
      }),
    ).toBe(false)
    expect(draws).toEqual([])
  })

  it('방 밖 소켓은 NOT_IN_ROOM이다', async () => {
    const stranger = fakeSocket()

    await module.handle(stranger, inbound({ inputSeq: 1, reactionMs: 100 }))

    expect(errorOf(stranger).code).toBe('NOT_IN_ROOM')
    expect(draws).toEqual([])
  })

  it('봉투의 roomId가 현재 방과 다르면 NOT_IN_ROOM이다', async () => {
    await module.handle(socket, inbound({ inputSeq: 1, reactionMs: 100 }, 'OTHER'))

    expect(errorOf(socket).code).toBe('NOT_IN_ROOM')
    expect(draws).toEqual([])
  })

  it('roomId가 없으면 NOT_IN_ROOM이다', async () => {
    await module.handle(socket, inbound({ inputSeq: 1, reactionMs: 100 }, null))

    expect(errorOf(socket).code).toBe('NOT_IN_ROOM')
  })

  it('형식이 깨진 payload는 INVALID_MESSAGE다', async () => {
    await module.handle(socket, inbound({ inputSeq: 'one' }))

    expect(errorOf(socket)).toEqual({
      code: 'INVALID_MESSAGE',
      message: 'invalid draw payload',
      refMsgId: 'msg-1',
    })
    expect(draws).toEqual([])
  })

  it('도메인 거부는 코드 문자열을 그대로 보낸다', async () => {
    failure = new DomainError('invalid_duel_draw')

    await module.handle(socket, inbound({ inputSeq: 0, reactionMs: 0 }))

    expect(errorOf(socket).message).toBe('invalid_duel_draw')
  })

  it('그 밖의 실패는 invalid draw payload로 뭉갠다', async () => {
    failure = new Error('redis down')

    await module.handle(socket, inbound({ inputSeq: 1, reactionMs: 1 }))

    expect(errorOf(socket).message).toBe('invalid draw payload')
  })
})
