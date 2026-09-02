import type { Redis } from 'ioredis'
import { beforeEach, expect } from 'vitest'
import { type GameModule, GameModuleRegistry } from '../../game/module.js'
import type { RoomCloseScheduler } from '../../room/closeScheduler.js'
import { RoomService } from '../../room/roomService.js'
import { type GuestSession, UserService } from '../../user/session.js'
import { RoomBroadcaster } from '../broadcaster.js'
import type { InboundEnvelope, OutboundEnvelope } from '../envelope.js'
import { GameSocketHandler } from '../handler.js'
import { HeartbeatMonitor } from '../heartbeat.js'
import type { WsRoomSnapshot } from '../protocol.js'
import { RoomSessionRegistry } from '../registry.js'
import { RealtimeRoomSnapshotService } from '../snapshot.js'
import type { ClientSocket } from '../socket.js'

export class FakeSocket implements ClientSocket {
  readyState = 1
  closeCode: number | null = null
  readonly sent: string[] = []

  send(data: string): void {
    this.sent.push(data)
  }

  close(code?: number): void {
    this.closeCode = code ?? 1000
    this.readyState = 3
  }

  messages(): OutboundEnvelope[] {
    return this.sent.map((raw) => JSON.parse(raw) as OutboundEnvelope)
  }

  types(): string[] {
    return this.messages().map((message) => message.type)
  }

  first(type: string): OutboundEnvelope | undefined {
    return this.messages().find((message) => message.type === type)
  }

  only(): OutboundEnvelope {
    expect(this.sent).toHaveLength(1)
    return this.messages()[0] as OutboundEnvelope
  }

  clear(): void {
    this.sent.length = 0
  }
}

/** 유예를 실시간으로 기다리지 않고 원할 때 터뜨린다. */
class FakeCloseScheduler implements RoomCloseScheduler {
  lastDelayMs: number | null = null
  private readonly pending = new Map<string, () => void | Promise<void>>()

  schedule(roomId: string, delayMs: number, closeTask: () => void | Promise<void>): void {
    this.lastDelayMs = delayMs
    this.pending.set(roomId, closeTask)
  }

  cancel(roomId: string): boolean {
    return this.pending.delete(roomId)
  }

  isPending(roomId: string): boolean {
    return this.pending.has(roomId)
  }

  async fire(roomId: string): Promise<void> {
    const task = this.pending.get(roomId)
    this.pending.delete(roomId)
    await task?.()
  }
}

interface StubModule {
  readonly module: GameModule
  readonly calls: string[]
  readonly handled: InboundEnvelope[]
}

export const stubModule = (
  options: {
    hasState?: boolean
    reconnect?: () => WsRoomSnapshot
    events?: string[]
    onHandle?: () => never
  } = {},
): StubModule => {
  const calls: string[] = []
  const handled: InboundEnvelope[] = []
  const module: GameModule = {
    code: 'YACHT_DICE',
    start: async () => {},
    reset: async () => {},
    resume: async () => {
      calls.push('resume')
    },
    pause: async () => {
      calls.push('pause')
    },
    rehydrate: async () => {
      calls.push('rehydrate')
    },
    removePlayer: async (_roomId, playerId) => {
      calls.push(`removePlayer:${playerId}`)
    },
    close: async () => {
      calls.push('close')
    },
    hasState: async () => options.hasState ?? false,
    reconnect: async (roomId, playerId) => {
      calls.push('reconnect')
      if (options.reconnect) return options.reconnect()
      return {
        roomId,
        phase: 'playing',
        players: [],
        game: { activePlayerId: playerId },
      }
    },
    handles: (eventType) => (options.events ?? []).includes(eventType),
    handle: async (_socket, message) => {
      handled.push(message)
      options.onHandle?.()
    },
  }
  return { module, calls, handled }
}

export const frame = (
  type: string,
  payload: unknown,
  extra: Record<string, unknown> = {},
): string => JSON.stringify({ type, ts: Date.now(), payload, ...extra })

export const joinFrame = (
  roomId: string,
  identity: { nickname?: string; sessionToken?: string },
  msgId?: string,
): string => frame('room.join', { roomId, ...identity }, msgId ? { msgId } : {})

/**
 * 게이트웨이 한 벌을 매 테스트마다 새로 세운다. 실물을 그대로 쓰고 대역은 폐쇄
 * 예약기 하나뿐이다 — 방·세션은 Redis 하네스가 진짜로 돌린다.
 *
 * 반환값을 구조 분해하지 말 것: `beforeEach`가 인스턴스를 갈아 끼우므로 매번 속성으로
 * 읽어야 그 판의 것을 본다.
 */
export interface WsHandlerHarness {
  readonly rooms: RoomService
  readonly users: UserService
  readonly registry: RoomSessionRegistry
  readonly broadcaster: RoomBroadcaster
  readonly heartbeat: HeartbeatMonitor
  readonly closeScheduler: FakeCloseScheduler
  readonly games: GameModuleRegistry
  readonly handler: GameSocketHandler
  /** REST(`POST /rooms`)로 방과 좌석을 만든 상태 — WS join의 전제 조건이다. */
  openRoom(nickname?: string): Promise<{ roomCode: string; host: GuestSession }>
  enter(roomCode: string, guest: GuestSession): Promise<FakeSocket>
  /** 이미 열린 방에 좌석 하나를 더 만든다(아직 소켓은 붙지 않았다). */
  addGuest(roomCode: string, nickname?: string): Promise<GuestSession>
  /**
   * 호스트와 참가자가 각각 소켓으로 들어와 있는 방. 호스트 쪽은 받은 것을 비워 두므로
   * 검사가 보는 것은 **그 뒤에 온 것**뿐이다.
   */
  enterPair(nickname?: string): Promise<{
    roomCode: string
    host: GuestSession
    hostSocket: FakeSocket
    guest: GuestSession
    guestSocket: FakeSocket
  }>
}

export function useWsHandler(redis: () => Redis): WsHandlerHarness {
  let rooms: RoomService
  let users: UserService
  let registry: RoomSessionRegistry
  let broadcaster: RoomBroadcaster
  let heartbeat: HeartbeatMonitor
  let closeScheduler: FakeCloseScheduler
  let games: GameModuleRegistry
  let handler: GameSocketHandler

  beforeEach(() => {
    rooms = new RoomService(redis())
    users = new UserService(redis())
    registry = new RoomSessionRegistry()
    broadcaster = new RoomBroadcaster()
    heartbeat = new HeartbeatMonitor({ startScheduler: false })
    closeScheduler = new FakeCloseScheduler()
    games = new GameModuleRegistry()
    handler = new GameSocketHandler({
      registry,
      broadcaster,
      snapshots: new RealtimeRoomSnapshotService(rooms, registry),
      heartbeat,
      users,
      rooms,
      closeScheduler,
      games,
    })
  })

  return {
    get rooms() {
      return rooms
    },
    get users() {
      return users
    },
    get registry() {
      return registry
    },
    get broadcaster() {
      return broadcaster
    },
    get heartbeat() {
      return heartbeat
    },
    get closeScheduler() {
      return closeScheduler
    },
    get games() {
      return games
    },
    get handler() {
      return handler
    },
    async openRoom(nickname = '호스트') {
      const host = await users.createGuest(nickname)
      const roomCode = await rooms.createRoom(6, host.userId, 'YACHT_DICE')
      await rooms.join(roomCode, { userId: host.userId, nickname: host.nickname, type: 'GUEST' })
      return { roomCode, host }
    },
    async enter(roomCode: string, guest: GuestSession) {
      const socket = new FakeSocket()
      await handler.message(socket, joinFrame(roomCode, { sessionToken: guest.sessionToken }))
      socket.clear()
      return socket
    },
    async addGuest(roomCode: string, nickname = '참가자') {
      const guest = await users.createGuest(nickname)
      await rooms.join(roomCode, { userId: guest.userId, nickname: guest.nickname, type: 'GUEST' })
      return guest
    },
    async enterPair(nickname = '참가자') {
      const { roomCode, host } = await this.openRoom()
      const hostSocket = await this.enter(roomCode, host)
      const guest = await this.addGuest(roomCode, nickname)
      const guestSocket = await this.enter(roomCode, guest)
      hostSocket.clear()
      return { roomCode, host, hostSocket, guest, guestSocket }
    },
  }
}
