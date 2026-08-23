import { beforeEach, expect, it, vi } from 'vitest'
import { describeRedis, useRedis } from '../../../test/redisHarness.js'
import { type GameModule, GameModuleRegistry } from '../../game/module.js'
import type { RoomCloseScheduler } from '../../room/closeScheduler.js'
import { RoomService } from '../../room/roomService.js'
import { type GuestSession, UserService } from '../../user/session.js'
import { RoomBroadcaster } from '../broadcaster.js'
import { envelope, type InboundEnvelope, type OutboundEnvelope } from '../envelope.js'
import { ACTIVE_GAME_GRACE_MS, EMPTY_LOBBY_GRACE_MS, GameSocketHandler } from '../handler.js'
import { HeartbeatMonitor } from '../heartbeat.js'
import type { WsRoomSnapshot } from '../protocol.js'
import { RoomSessionRegistry } from '../registry.js'
import { RealtimeRoomSnapshotService } from '../snapshot.js'
import type { ClientSocket } from '../socket.js'

class FakeSocket implements ClientSocket {
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

/** 유예를 실시간으로 기다리지 않고 원할 때 터뜨린다(Java `FakeRoomCloseScheduler`). */
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

const stubModule = (
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

const frame = (type: string, payload: unknown, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ type, ts: Date.now(), payload, ...extra })

const joinFrame = (
  roomId: string,
  identity: { nickname?: string; sessionToken?: string },
  msgId?: string,
): string => frame('room.join', { roomId, ...identity }, msgId ? { msgId } : {})

describeRedis('GameSocketHandler', () => {
  const redis = useRedis()

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

  /** REST(`POST /rooms`)로 방과 좌석을 만든 상태 — WS join의 전제 조건이다. */
  const openRoom = async (
    nickname = '호스트',
  ): Promise<{ roomCode: string; host: GuestSession }> => {
    const host = await users.createGuest(nickname)
    const roomCode = await rooms.createRoom(6, host.userId, 'YACHT_DICE')
    await rooms.join(roomCode, { userId: host.userId, nickname: host.nickname, type: 'GUEST' })
    return { roomCode, host }
  }

  const enter = async (roomCode: string, guest: GuestSession): Promise<FakeSocket> => {
    const socket = new FakeSocket()
    await handler.message(socket, joinFrame(roomCode, { sessionToken: guest.sessionToken }))
    socket.clear()
    return socket
  }

  /* ------------------------------------------------------------------ 연결·하트비트 */

  it('연결 직후 sys.connected로 하트비트 규칙을 알린다', () => {
    const socket = new FakeSocket()

    handler.connected(socket)

    expect(socket.only()).toMatchObject({
      type: 'sys.connected',
      payload: { protocolVersion: 1, heartbeatIntervalMs: 30_000 },
    })
    // 방 밖 메시지라 roomId·msgId는 실리지 않는다.
    expect(socket.only().roomId).toBeUndefined()
  })

  it('ping은 하트비트를 먼저 갱신하고 pong을 보낸다', async () => {
    const socket = new FakeSocket()
    handler.connected(socket)
    socket.clear()
    const recordPing = vi.spyOn(heartbeat, 'recordPing')

    await handler.message(socket, frame('sys.ping', { clientTs: 1 }))

    expect(recordPing).toHaveBeenCalledWith(socket)
    expect(socket.only().type).toBe('sys.pong')
  })

  it('하트비트 타임아웃은 사유를 보낸 뒤 1008로 닫는다', () => {
    const socket = new FakeSocket()
    const now = { value: 0 }
    const monitor = new HeartbeatMonitor({
      now: () => now.value,
      timeoutMs: 90_000,
      startScheduler: false,
    })
    handler = new GameSocketHandler({
      registry,
      broadcaster,
      snapshots: new RealtimeRoomSnapshotService(rooms, registry),
      heartbeat: monitor,
      users,
      rooms,
      closeScheduler,
      games,
    })
    handler.connected(socket)
    socket.clear()

    now.value = 90_000
    monitor.sweep()

    expect(socket.only()).toMatchObject({
      type: 'sys.disconnect',
      payload: { reason: 'idle_timeout' },
    })
    expect(socket.closeCode).toBe(1008)
  })

  it('깨진 봉투는 연결을 유지한 채 INVALID_MESSAGE로 답한다', async () => {
    const socket = new FakeSocket()

    await handler.message(socket, 'not-json')

    expect(socket.only()).toMatchObject({ type: 'error', payload: { code: 'INVALID_MESSAGE' } })
    expect(socket.only().payload).not.toHaveProperty('refMsgId')
    expect(socket.closeCode).toBeNull()
  })

  /* ----------------------------------------------------------------------- room.join */

  /**
   * 유예가 끝나 방이 닫힌 뒤의 "이어서 하기". 메모리에만 있는 유령 방에 입장시키면
   * 대기실 화면에서 게임 시작이 404로 실패하는 막힌 상태가 된다.
   */
  it('Redis에 없는 방의 join은 거부하고 명단에도 올리지 않는다', async () => {
    const socket = new FakeSocket()

    await handler.message(socket, joinFrame('GONE01', { nickname: '유령' }, 'join-gone'))

    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'ROOM_NOT_FOUND', refMsgId: 'join-gone' },
    })
    expect(registry.of(socket)).toBeNull()
  })

  it('최초 참가는 본인에게 room.joined, 기존 멤버에게만 player_joined를 보낸다', async () => {
    const { roomCode, host } = await openRoom()
    const hostSocket = await enter(roomCode, host)
    const guest = await users.createGuest('참가자')
    await rooms.join(roomCode, { userId: guest.userId, nickname: guest.nickname, type: 'GUEST' })
    const guestSocket = new FakeSocket()

    await handler.message(guestSocket, joinFrame(roomCode, { sessionToken: guest.sessionToken }))

    const joined = guestSocket.only()
    expect(joined).toMatchObject({
      type: 'room.joined',
      roomId: roomCode,
      payload: { you: guest.userId, sessionToken: guest.sessionToken },
    })
    expect((joined.payload as { snapshot: { players: unknown[] } }).snapshot.players).toHaveLength(
      2,
    )
    // 본인은 팬아웃 등록 전이라 자기 입장 소식을 받지 않는다.
    expect(guestSocket.types()).not.toContain('room.player_joined')
    expect(hostSocket.only()).toMatchObject({
      type: 'room.player_joined',
      roomId: roomCode,
      payload: { player: { playerId: guest.userId, status: 'online', isHost: false } },
    })
    // 최초 입장은 player_joined가 status를 나르므로 presence는 쏘지 않는다.
    expect(hostSocket.types()).not.toContain('presence.update')
  })

  it('세션 토큰이 있으면 게스트를 새로 만들지 않는다', async () => {
    const { roomCode, host } = await openRoom()
    const createGuest = vi.spyOn(users, 'createGuest')
    const socket = new FakeSocket()

    await handler.message(
      socket,
      joinFrame(roomCode, { nickname: '무시된 닉네임', sessionToken: host.sessionToken }, 'join-a'),
    )

    expect(createGuest).not.toHaveBeenCalled()
    expect(socket.only().payload).toMatchObject({ you: host.userId })
    expect(registry.of(socket)?.nickname).toBe(host.nickname)
  })

  /** 만료를 INVALID_MESSAGE로 뭉개면 클라이언트가 재입장 복구 경로를 돌리지 못한다. */
  it('만료된 토큰은 SESSION_EXPIRED다', async () => {
    const { roomCode } = await openRoom()
    const socket = new FakeSocket()

    await handler.message(
      socket,
      joinFrame(roomCode, { sessionToken: 'stale-token' }, 'join-stale'),
    )

    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'SESSION_EXPIRED', refMsgId: 'join-stale' },
    })
    expect(registry.of(socket)).toBeNull()
  })

  /** 닉네임 규칙 위반은 그대로 INVALID_MESSAGE — 두 실패가 다시 뭉치지 않게 함께 고정한다. */
  it('닉네임 불량은 INVALID_MESSAGE다', async () => {
    const { roomCode } = await openRoom()
    const socket = new FakeSocket()

    await handler.message(socket, joinFrame(roomCode, { nickname: '   ' }, 'join-bad-nickname'))

    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'INVALID_MESSAGE', refMsgId: 'join-bad-nickname' },
    })
    expect(String((socket.only().payload as { message: string }).message)).toContain('닉네임')
  })

  it('roomId가 없는 join은 INVALID_MESSAGE다', async () => {
    const socket = new FakeSocket()

    await handler.message(socket, frame('room.join', { nickname: '아무개' }, { msgId: 'no-room' }))

    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'INVALID_MESSAGE', refMsgId: 'no-room' },
    })
  })

  it('시작된 게임에는 좌석 없는 사람이 새로 들어올 수 없다', async () => {
    const { roomCode, host } = await openRoom()
    await enter(roomCode, host)
    await rooms.startGame(roomCode, 1)
    const newcomer = await users.createGuest('늦은 손님')
    const socket = new FakeSocket()

    await handler.message(
      socket,
      joinFrame(roomCode, { sessionToken: newcomer.sessionToken }, 'join-active'),
    )

    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'GAME_ALREADY_STARTED', refMsgId: 'join-active' },
    })
    expect(registry.of(socket)).toBeNull()
  })

  /* ---------------------------------------------------------------------- 재접속 */

  it('재접속은 좌석을 유지한 채 소켓을 교체하고 스냅샷으로 동기화한다', async () => {
    const { module } = stubModule()
    games.register(module)
    const { roomCode, host } = await openRoom()
    const oldSocket = await enter(roomCode, host)
    await rooms.startGame(roomCode, 1)
    const newSocket = new FakeSocket()

    await handler.message(
      newSocket,
      joinFrame(roomCode, { sessionToken: host.sessionToken }, 'reconnect-a'),
    )

    expect(oldSocket.only()).toMatchObject({
      type: 'sys.disconnect',
      payload: { reason: 'replaced_by_new_session' },
    })
    expect(oldSocket.closeCode).toBe(1008)
    expect(newSocket.first('sys.reconnected')).toMatchObject({
      roomId: roomCode,
      msgId: 'reconnect-a',
      payload: { snapshot: { game: { activePlayerId: host.userId } } },
    })
    // 재접속 분기에서는 room.joined·player_joined가 나가지 않는다.
    expect(newSocket.types()).toEqual(['sys.reconnected', 'presence.update'])
    expect(newSocket.first('presence.update')).toMatchObject({
      payload: { playerId: host.userId, status: 'online' },
    })
    expect(registry.of(oldSocket)).toBeNull()
    expect(registry.of(newSocket)?.playerId).toBe(host.userId)
  })

  it('재접속 스냅샷 생성이 실패하면 INTERNAL과 함께 팬아웃에서 뺀다', async () => {
    const { module } = stubModule({
      reconnect: () => {
        throw new Error('라운드 상태 없음')
      },
    })
    games.register(module)
    const { roomCode, host } = await openRoom()
    const oldSocket = await enter(roomCode, host)
    const newSocket = new FakeSocket()

    await handler.message(
      newSocket,
      joinFrame(roomCode, { sessionToken: host.sessionToken }, 'reconnect-fail'),
    )

    expect(newSocket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'INTERNAL', refMsgId: 'reconnect-fail' },
    })
    newSocket.clear()
    broadcaster.broadcast(roomCode, envelope('state.sync', {}, { roomId: roomCode }))
    expect(newSocket.sent).toHaveLength(0)
    expect(oldSocket.sent.filter((raw) => raw.includes('state.sync'))).toHaveLength(0)
  })

  /* ------------------------------------------------------------ room.ready·reaction */

  it('room.ready는 상태를 저장하지 않고 본인 포함 전체에 릴레이한다', async () => {
    const { roomCode, host } = await openRoom()
    const socket = await enter(roomCode, host)

    await handler.message(socket, frame('room.ready', { ready: true }, { msgId: 'ready-a' }))

    expect(socket.only()).toMatchObject({
      type: 'room.ready_changed',
      roomId: roomCode,
      payload: { playerId: host.userId, ready: true },
    })
  })

  it('방 밖에서 보낸 room.ready·reaction은 NOT_IN_ROOM이다', async () => {
    const readySocket = new FakeSocket()
    const reactionSocket = new FakeSocket()

    await handler.message(readySocket, frame('room.ready', { ready: true }))
    await handler.message(reactionSocket, frame('reaction.send', { reaction: 'like' }))

    expect(readySocket.only().payload).toMatchObject({ code: 'NOT_IN_ROOM' })
    expect(reactionSocket.only().payload).toMatchObject({ code: 'NOT_IN_ROOM' })
  })

  it('reaction.send는 본인 포함 방 전체에 뿌리고, 모르는 값은 거부한다', async () => {
    const { roomCode, host } = await openRoom()
    const socket = await enter(roomCode, host)

    await handler.message(socket, frame('reaction.send', { reaction: 'gg' }))

    expect(socket.only()).toMatchObject({
      type: 'reaction.broadcast',
      roomId: roomCode,
      payload: { playerId: host.userId, reaction: 'gg' },
    })

    socket.clear()
    await handler.message(socket, frame('reaction.send', { reaction: 'boo' }, { msgId: 'bad' }))

    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'INVALID_MESSAGE', refMsgId: 'bad' },
    })
  })

  it('방에 들어가기 전 게임 메시지는 AUTH_REQUIRED다', async () => {
    const stranger = new FakeSocket()

    await handler.message(
      stranger,
      frame('game.yacht_dice.dice.roll', {}, { msgId: 'roll-before-join' }),
    )

    expect(stranger.only()).toMatchObject({
      type: 'error',
      payload: { code: 'AUTH_REQUIRED', refMsgId: 'roll-before-join' },
    })
  })

  /* ------------------------------------------------------------ 게임 네임스페이스 */

  it('방의 게임 모듈에 접두사를 벗긴 이벤트로 넘긴다', async () => {
    const { module, handled } = stubModule({ events: ['dice.roll'] })
    games.register(module)
    const { roomCode, host } = await openRoom()
    const socket = await enter(roomCode, host)

    await handler.message(
      socket,
      frame('game.yacht_dice.dice.roll', { keep: [true] }, { msgId: 'roll-1', roomId: roomCode }),
    )

    expect(handled).toEqual([
      {
        type: 'dice.roll',
        ts: expect.any(Number),
        payload: { keep: [true] },
        roomId: roomCode,
        msgId: 'roll-1',
      },
    ])
    // 응답은 모듈이 만든다 — 게이트웨이는 아무것도 보내지 않는다.
    expect(socket.sent).toHaveLength(0)
  })

  it('다른 게임 네임스페이스·모르는 이벤트는 INVALID_MESSAGE다', async () => {
    const { module, handled } = stubModule({ events: ['dice.roll'] })
    games.register(module)
    const { roomCode, host } = await openRoom()
    const socket = await enter(roomCode, host)

    await handler.message(socket, frame('game.duel.dice.roll', {}, { msgId: 'cross' }))
    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'INVALID_MESSAGE', refMsgId: 'cross' },
    })

    socket.clear()
    await handler.message(socket, frame('game.yacht_dice.dice.spin', {}, { msgId: 'unknown' }))
    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'INVALID_MESSAGE', refMsgId: 'unknown' },
    })
    expect(handled).toHaveLength(0)
  })

  /** 모듈이 아직 없는 게임의 방도 대기실은 돌아간다 — 게임 메시지만 거절된다. */
  it('등록된 모듈이 없으면 게임 메시지는 INVALID_MESSAGE다', async () => {
    const { roomCode, host } = await openRoom()
    const socket = await enter(roomCode, host)

    await handler.message(socket, frame('game.yacht_dice.dice.roll', {}, { msgId: 'no-module' }))

    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'INVALID_MESSAGE', refMsgId: 'no-module' },
    })
  })

  /* -------------------------------------------------------------- 끊김·방 폐쇄 */

  it('대기실에서 끊기면 명단에서 빠지고 남은 사람이 player_left를 받는다', async () => {
    const { roomCode, host } = await openRoom()
    const hostSocket = await enter(roomCode, host)
    const guest = await users.createGuest('참가자')
    await rooms.join(roomCode, { userId: guest.userId, nickname: guest.nickname, type: 'GUEST' })
    const guestSocket = await enter(roomCode, guest)
    hostSocket.clear()

    await handler.closed(guestSocket)

    expect(registry.snapshot(roomCode).players.map((player) => player.playerId)).toEqual([
      host.userId,
    ])
    expect(hostSocket.only()).toMatchObject({
      type: 'room.player_left',
      payload: { playerId: guest.userId },
    })
  })

  it('게임 중 끊김은 좌석을 남기고 presence.update{offline}만 보낸다', async () => {
    const { roomCode, host } = await openRoom()
    const hostSocket = await enter(roomCode, host)
    const guest = await users.createGuest('참가자')
    await rooms.join(roomCode, { userId: guest.userId, nickname: guest.nickname, type: 'GUEST' })
    const guestSocket = await enter(roomCode, guest)
    registry.markPhase(roomCode, 'playing')
    hostSocket.clear()

    await handler.closed(guestSocket)

    expect(registry.snapshot(roomCode).players).toHaveLength(2)
    expect(registry.find(roomCode, guest.userId)?.status).toBe('offline')
    expect(hostSocket.only()).toMatchObject({
      type: 'presence.update',
      payload: { playerId: guest.userId, status: 'offline' },
    })
    expect(hostSocket.types()).not.toContain('room.player_left')
    expect(closeScheduler.isPending(roomCode)).toBe(false)
  })

  it('대기실의 마지막 소켓이 빠지면 30초 유예를 준다', async () => {
    const { module, calls } = stubModule({ hasState: false })
    games.register(module)
    const { roomCode, host } = await openRoom()
    const socket = await enter(roomCode, host)

    await handler.closed(socket)

    expect(closeScheduler.isPending(roomCode)).toBe(true)
    expect(closeScheduler.lastDelayMs).toBe(EMPTY_LOBBY_GRACE_MS)
    // 마감 타이머는 즉시 끊는다 — 빈 방이 25초마다 자동 진행되면 안 된다.
    expect(calls).toContain('pause')
  })

  /** 유예 기준은 phase가 아니라 "잃을 것이 있는지"다 — 30초는 앱 전환·화면 잠금에 너무 짧다. */
  it('진행 상태가 남아 있으면 10분 유예를 준다', async () => {
    const { module } = stubModule({ hasState: true })
    games.register(module)
    const { roomCode, host } = await openRoom()
    const socket = await enter(roomCode, host)

    await handler.closed(socket)

    expect(closeScheduler.lastDelayMs).toBe(ACTIVE_GAME_GRACE_MS)
    // 진행 상태는 아직 살려둔다 — 새로고침으로 돌아올 수 있다.
    expect((await rooms.getSnapshot(roomCode)).phase).toBe('LOBBY')
  })

  it('유예 안에 아무도 안 돌아오면 방을 닫는다', async () => {
    const { module, calls } = stubModule({ hasState: true })
    games.register(module)
    const { roomCode, host } = await openRoom()
    const socket = await enter(roomCode, host)
    await handler.closed(socket)

    await closeScheduler.fire(roomCode)

    expect(calls).toContain('close')
    expect((await rooms.getSnapshot(roomCode)).phase).toBeNull()
  })

  it('유예 중 누가 돌아오면 예약을 취소하고 타이머를 재개한다', async () => {
    const { module, calls } = stubModule({ hasState: true })
    games.register(module)
    const { roomCode, host } = await openRoom()
    const first = await enter(roomCode, host)
    await handler.closed(first)
    expect(closeScheduler.isPending(roomCode)).toBe(true)

    // 새로고침으로 돌아온다 — 같은 세션 토큰, 새 소켓.
    const second = new FakeSocket()
    await handler.message(second, joinFrame(roomCode, { sessionToken: host.sessionToken }))

    expect(closeScheduler.isPending(roomCode)).toBe(false)
    expect(calls).toContain('resume')
    expect((await rooms.getSnapshot(roomCode)).phase).toBe('LOBBY')
  })

  it('다른 사람이 남아 있으면 아무것도 예약하지 않는다', async () => {
    const { module, calls } = stubModule({ hasState: true })
    games.register(module)
    const { roomCode, host } = await openRoom()
    const hostSocket = await enter(roomCode, host)
    const guest = await users.createGuest('참가자')
    await rooms.join(roomCode, { userId: guest.userId, nickname: guest.nickname, type: 'GUEST' })
    await enter(roomCode, guest)

    await handler.closed(hostSocket)

    expect(closeScheduler.isPending(roomCode)).toBe(false)
    expect(calls).not.toContain('pause')
  })

  /**
   * 게임 중 명시 퇴장은 명단 제거·턴 순서 정리·방송이 한 덩어리라 게임 모듈이 맡는다
   * (소켓 종료는 offline 처리로 빠지므로 그 경로와 구분해야 한다). 핸들러의 책임은
   * 팬아웃에서 빼고 그쪽에 위임하는 것까지다.
   */
  it('게임 중 room.leave는 게임 모듈의 이탈 경로로 넘긴다', async () => {
    const { module, calls } = stubModule({ hasState: true })
    games.register(module)
    const { roomCode, host } = await openRoom()
    const socket = await enter(roomCode, host)
    registry.markPhase(roomCode, 'playing')

    await handler.message(socket, frame('room.leave', {}, { msgId: 'leave-a' }))

    expect(calls).toContain(`removePlayer:${host.userId}`)
    // 팬아웃에서도 빠졌는지 — 이후 방 방송이 본인에게 가지 않아야 한다.
    socket.clear()
    broadcaster.broadcast(roomCode, envelope('state.sync', {}, { roomId: roomCode }))
    expect(socket.sent).toHaveLength(0)
  })

  it('대기실 room.leave는 명단에서 빼고 player_left를 방에 알린다', async () => {
    const { roomCode, host } = await openRoom()
    const hostSocket = await enter(roomCode, host)
    const guest = await users.createGuest('참가자')
    await rooms.join(roomCode, { userId: guest.userId, nickname: guest.nickname, type: 'GUEST' })
    const guestSocket = await enter(roomCode, guest)
    hostSocket.clear()

    await handler.message(guestSocket, frame('room.leave', {}))

    expect(registry.of(guestSocket)).toBeNull()
    expect(hostSocket.only()).toMatchObject({
      type: 'room.player_left',
      payload: { playerId: guest.userId },
    })
    // WS 퇴장은 Redis 명단을 바꾸지 않는다 — 유예 후 close가 정리한다.
    expect((await rooms.getSnapshot(roomCode)).players).toHaveLength(2)
  })
})
