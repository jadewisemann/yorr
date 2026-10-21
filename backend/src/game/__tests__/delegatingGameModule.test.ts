import { describe, expect, it } from 'vitest'
import type { InboundEnvelope } from '../../ws/envelope.js'
import type { WsRoomSnapshot } from '../../ws/protocol.js'
import { type ClientSocket, SOCKET_OPEN } from '../../ws/socket.js'
import {
  DelegatingGameModule,
  type DelegatingGameService,
  sendModuleError,
} from '../delegatingGameModule.js'
import type { GameModule } from '../module.js'

const ROOM = 'ROOM1'
const PLAYER = 'player-1'

type Call = { readonly hook: string; readonly args: readonly unknown[] }

/** 훅 7개를 전부 기록하는 서비스. 게임 고유 메서드는 없다 — 위임만 보는 스텁이다. */
const recordingService = (): { service: DelegatingGameService; calls: Call[] } => {
  const calls: Call[] = []
  const record =
    (hook: string) =>
    async (...args: unknown[]): Promise<undefined> => {
      calls.push({ hook, args })
      return undefined
    }
  return {
    calls,
    service: {
      reset: record('reset'),
      pause: record('pause'),
      resume: record('resume'),
      rehydrate: record('rehydrate'),
      removePlayer: record('removePlayer'),
      close: record('close'),
      hasState: async (...args) => {
        calls.push({ hook: 'hasState', args })
        return true
      },
    },
  }
}

/** 베이스가 채우지 않는 다섯 멤버만 채운 최소 모듈. */
class StubModule extends DelegatingGameModule<DelegatingGameService> implements GameModule {
  readonly code = 'STUB'

  async start(): Promise<void> {}
  async reconnect(_roomCode: string): Promise<WsRoomSnapshot> {
    return {} as WsRoomSnapshot
  }
  handles(): boolean {
    return false
  }
  async handle(): Promise<void> {}
}

/**
 * `DelegatingGameModule`은 결투·다빈치·탁구가 복창하던 위임 7개를 한 곳으로 모은
 * 베이스다. 위임이 **같은 인자**로 서비스에 도달하는지가 계약이다 — 어긋나면
 * pause가 resume을 부르는 식의 사고가 조용히 난다.
 */
describe('DelegatingGameModule', () => {
  it('일곱 훅을 같은 이름·같은 인자로 서비스에 넘긴다', async () => {
    const { service, calls } = recordingService()
    const module = new StubModule(service)

    await module.reset(ROOM)
    await module.pause(ROOM)
    await module.resume(ROOM)
    await module.rehydrate(ROOM)
    await module.removePlayer(ROOM, PLAYER)
    await module.close(ROOM)
    await expect(module.hasState(ROOM)).resolves.toBe(true)

    expect(calls).toEqual([
      { hook: 'reset', args: [ROOM] },
      { hook: 'pause', args: [ROOM] },
      { hook: 'resume', args: [ROOM] },
      { hook: 'rehydrate', args: [ROOM] },
      { hook: 'removePlayer', args: [ROOM, PLAYER] },
      { hook: 'close', args: [ROOM] },
      { hook: 'hasState', args: [ROOM] },
    ])
  })

  it('서비스가 던지면 그대로 올린다', async () => {
    const { service } = recordingService()
    service.pause = async () => {
      throw new Error('boom')
    }
    await expect(new StubModule(service).pause(ROOM)).rejects.toThrow('boom')
  })

  it('hasState의 false를 undefined로 뭉개지 않는다', async () => {
    const { service } = recordingService()
    service.hasState = async () => false
    await expect(new StubModule(service).hasState(ROOM)).resolves.toBe(false)
  })
})

/** `error` 봉투의 모양 — roomId·msgId를 싣지 않고 payload.refMsgId로 짝을 맞춘다. */
describe('sendModuleError', () => {
  const request: InboundEnvelope = { type: 'draw', ts: 1, payload: {}, msgId: 'msg-1' }

  const socketOf = (
    sent: string[],
    readyState: number = SOCKET_OPEN,
    onSend?: () => void,
  ): ClientSocket => ({
    readyState,
    send: (data: string) => {
      onSend?.()
      sent.push(data)
    },
    close: () => {},
  })

  it('refMsgId로 짝을 맞추고 roomId·msgId는 싣지 않는다', () => {
    const sent: string[] = []
    sendModuleError(socketOf(sent), 'NOT_IN_ROOM', 'membership required', request)

    expect(sent).toHaveLength(1)
    const frame = JSON.parse(sent[0] as string) as Record<string, unknown>
    expect(frame.type).toBe('error')
    expect(frame.roomId).toBeUndefined()
    expect(frame.msgId).toBeUndefined()
    expect(frame.payload).toEqual({
      code: 'NOT_IN_ROOM',
      message: 'membership required',
      refMsgId: 'msg-1',
    })
  })

  it('msgId가 없으면 refMsgId 필드 자체를 지운다', () => {
    const sent: string[] = []
    sendModuleError(socketOf(sent), 'INVALID_MESSAGE', 'no id', {
      type: 'draw',
      ts: 1,
      payload: {},
    })

    expect(JSON.parse(sent[0] as string).payload).toEqual({
      code: 'INVALID_MESSAGE',
      message: 'no id',
    })
  })

  it('닫힌 소켓에는 쓰지 않는다', () => {
    const sent: string[] = []
    sendModuleError(socketOf(sent, 3), 'INVALID_MESSAGE', 'closed', request)
    expect(sent).toEqual([])
  })

  it('전송이 던져도 밖으로 새지 않는다', () => {
    const sent: string[] = []
    const socket = socketOf(sent, SOCKET_OPEN, () => {
      throw new Error('write after end')
    })
    expect(() => sendModuleError(socket, 'INVALID_MESSAGE', 'dead', request)).not.toThrow()
  })
})
