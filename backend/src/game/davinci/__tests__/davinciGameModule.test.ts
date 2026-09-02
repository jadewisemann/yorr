import { beforeEach, describe, expect, it } from 'vitest'
import { DomainError } from '../../../errors.js'
import type { InboundEnvelope } from '../../../ws/envelope.js'
import type { WsRoomSnapshot } from '../../../ws/protocol.js'
import type { ClientSocket } from '../../../ws/socket.js'
import { type FakeSocket, fakeSocket, lastFrame } from '../../__tests__/portDoubles.js'
import { GameModuleRegistry } from '../../module.js'
import { DavinciGameModule } from '../davinciGameModule.js'
import type { DavinciGameService } from '../davinciGameService.js'
import type { DavinciSessionLookup } from '../davinciPorts.js'

const ROOM = 'ROOM1'
const PLAYER = 'player-1'

/** `roomId: null`은 **필드 자체가 없는** 봉투를 뜻한다. */
const inbound = (
  type: string,
  payload: unknown,
  roomId: string | null = ROOM,
): InboundEnvelope => ({
  type,
  ts: 1,
  payload,
  ...(roomId === null ? {} : { roomId }),
  msgId: 'msg-1',
})

interface Call {
  readonly action: string
  readonly roomId: string
  readonly playerId: string
  readonly payload: unknown
}

/**
 * 모듈은 라우팅·검증·오류 응답만 한다 — 판정은 규칙이, 진행은 서비스가 맡는다
 * (결투 `DuelGameModule` 테스트와 같은 자리).
 */
describe('DavinciGameModule', () => {
  let calls: Call[]
  let failure: Error | null
  let module: DavinciGameModule
  let socket: FakeSocket

  const errorOf = (target: FakeSocket): { code: string; message: string } => {
    const frame = lastFrame(target)
    expect(frame.type).toBe('error')
    return frame.payload as unknown as { code: string; message: string }
  }

  beforeEach(() => {
    calls = []
    failure = null
    socket = fakeSocket()

    const record =
      (action: string) =>
      async (roomId: string, playerId: string, payload: unknown): Promise<void> => {
        if (failure !== null) throw failure
        calls.push({ action, roomId, playerId, payload })
      }

    const games = {
      guess: record('guess'),
      decide: record('decide'),
      place: record('place'),
    } as unknown as DavinciGameService<WsRoomSnapshot, ClientSocket>

    const sessions: DavinciSessionLookup<ClientSocket> = {
      of: (target) => (target === socket ? { playerId: PLAYER, roomId: ROOM } : null),
    }

    module = new DavinciGameModule(games, sessions)
  })

  it('세 가지 이벤트만 맡는다', () => {
    expect(module.handles('guess')).toBe(true)
    expect(module.handles('decide')).toBe(true)
    expect(module.handles('place')).toBe(true)
    expect(module.handles('draw')).toBe(false)
  })

  it('추측을 서비스로 넘긴다', async () => {
    await module.handle(
      socket,
      inbound('guess', { inputSeq: 1, targetId: 'player-2', tileId: 'T3', number: 7 }),
    )

    expect(calls).toEqual([
      {
        action: 'guess',
        roomId: ROOM,
        playerId: PLAYER,
        payload: { inputSeq: 1, targetId: 'player-2', tileId: 'T3', number: 7 },
      },
    ])
    expect(socket.sent).toHaveLength(0)
  })

  it('계속·멈춤과 조커 자리도 각각 넘긴다', async () => {
    await module.handle(socket, inbound('decide', { inputSeq: 2, decision: 'CONTINUE' }))
    await module.handle(socket, inbound('place', { inputSeq: 3, index: 1 }))

    expect(calls.map((call) => call.action)).toEqual(['decide', 'place'])
  })

  it('다른 방·명단 밖 소켓은 NOT_IN_ROOM이다', async () => {
    await module.handle(socket, inbound('guess', {}, 'OTHER'))
    expect(errorOf(socket).code).toBe('NOT_IN_ROOM')

    await module.handle(socket, inbound('guess', {}, null))
    expect(errorOf(socket).code).toBe('NOT_IN_ROOM')

    const stranger = fakeSocket()
    await module.handle(stranger, inbound('guess', {}))
    expect(errorOf(stranger).code).toBe('NOT_IN_ROOM')
    expect(calls).toHaveLength(0)
  })

  it('형식이 어긋난 payload는 INVALID_MESSAGE다', async () => {
    await module.handle(socket, inbound('guess', { inputSeq: 1, targetId: '', tileId: 'T1' }))

    expect(errorOf(socket).code).toBe('INVALID_MESSAGE')
    expect(calls).toHaveLength(0)
  })

  it('도메인 거부는 코드 문자열 그대로 나간다', async () => {
    failure = new DomainError('invalid_davinci_guess')

    await module.handle(
      socket,
      inbound('guess', { inputSeq: 1, targetId: 'player-2', tileId: 'T3', number: 7 }),
    )

    expect(errorOf(socket)).toMatchObject({
      code: 'INVALID_MESSAGE',
      message: 'invalid_davinci_guess',
    })
  })

  it('레지스트리가 네임스페이스를 붙여 라우팅한다', async () => {
    const registry = new GameModuleRegistry()
    registry.register(module)

    const routed = await registry.dispatch(
      'DAVINCI_CODE',
      socket,
      inbound('game.davinci_code.guess', {
        inputSeq: 1,
        targetId: 'player-2',
        tileId: 'T3',
        number: 0,
      }),
    )

    expect(routed).toBe(true)
    expect(calls).toHaveLength(1)
    // 다른 게임의 네임스페이스는 이 모듈로 오지 않는다.
    expect(await registry.dispatch('DAVINCI_CODE', socket, inbound('game.duel.draw', {}))).toBe(
      false,
    )
  })
})
