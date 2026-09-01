import { expect, it, vi } from 'vitest'
import { describeRedis, useRedis } from '../../../test/redisHarness.js'
import { envelope } from '../envelope.js'
import { FakeSocket, frame, joinFrame, stubModule, useWsHandler } from './wsHarness.js'

describeRedis('RoomJoinFlow', () => {
  const redis = useRedis()
  const h = useWsHandler(redis)

  it('Redis에 없는 방의 join은 거부하고 명단에도 올리지 않는다', async () => {
    const socket = new FakeSocket()

    await h.handler.message(socket, joinFrame('GONE01', { nickname: '유령' }, 'join-gone'))

    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'ROOM_NOT_FOUND', refMsgId: 'join-gone' },
    })
    expect(h.registry.of(socket)).toBeNull()
  })

  it('최초 참가는 본인에게 room.joined, 기존 멤버에게만 player_joined를 보낸다', async () => {
    const { roomCode, host } = await h.openRoom()
    const hostSocket = await h.enter(roomCode, host)
    const guest = await h.users.createGuest('참가자')
    await h.rooms.join(roomCode, { userId: guest.userId, nickname: guest.nickname, type: 'GUEST' })
    const guestSocket = new FakeSocket()

    await h.handler.message(guestSocket, joinFrame(roomCode, { sessionToken: guest.sessionToken }))

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
    const { roomCode, host } = await h.openRoom()
    const createGuest = vi.spyOn(h.users, 'createGuest')
    const socket = new FakeSocket()

    await h.handler.message(
      socket,
      joinFrame(roomCode, { nickname: '무시된 닉네임', sessionToken: host.sessionToken }, 'join-a'),
    )

    expect(createGuest).not.toHaveBeenCalled()
    expect(socket.only().payload).toMatchObject({ you: host.userId })
    expect(h.registry.of(socket)?.nickname).toBe(host.nickname)
  })

  /** 만료를 INVALID_MESSAGE로 뭉개면 클라이언트가 재입장 복구 경로를 돌리지 못한다. */
  it('만료된 토큰은 SESSION_EXPIRED다', async () => {
    const { roomCode } = await h.openRoom()
    const socket = new FakeSocket()

    await h.handler.message(
      socket,
      joinFrame(roomCode, { sessionToken: 'stale-token' }, 'join-stale'),
    )

    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'SESSION_EXPIRED', refMsgId: 'join-stale' },
    })
    expect(h.registry.of(socket)).toBeNull()
  })

  /** 닉네임 규칙 위반은 그대로 INVALID_MESSAGE — 두 실패가 다시 뭉치지 않게 함께 고정한다. */
  it('닉네임 불량은 INVALID_MESSAGE다', async () => {
    const { roomCode } = await h.openRoom()
    const socket = new FakeSocket()

    await h.handler.message(socket, joinFrame(roomCode, { nickname: '   ' }, 'join-bad-nickname'))

    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'INVALID_MESSAGE', refMsgId: 'join-bad-nickname' },
    })
    expect(String((socket.only().payload as { message: string }).message)).toContain('닉네임')
  })

  it('roomId가 없는 join은 INVALID_MESSAGE다', async () => {
    const socket = new FakeSocket()

    await h.handler.message(
      socket,
      frame('room.join', { nickname: '아무개' }, { msgId: 'no-room' }),
    )

    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'INVALID_MESSAGE', refMsgId: 'no-room' },
    })
  })

  it('시작된 게임에는 좌석 없는 사람이 새로 들어올 수 없다', async () => {
    const { roomCode, host } = await h.openRoom()
    await h.enter(roomCode, host)
    await h.rooms.startGame(roomCode, 1)
    const newcomer = await h.users.createGuest('늦은 손님')
    const socket = new FakeSocket()

    await h.handler.message(
      socket,
      joinFrame(roomCode, { sessionToken: newcomer.sessionToken }, 'join-active'),
    )

    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'GAME_ALREADY_STARTED', refMsgId: 'join-active' },
    })
    expect(h.registry.of(socket)).toBeNull()
  })

  /* ---------------------------------------------------------------------- 재접속 */

  it('재접속은 좌석을 유지한 채 소켓을 교체하고 스냅샷으로 동기화한다', async () => {
    const { module } = stubModule()
    h.games.register(module)
    const { roomCode, host } = await h.openRoom()
    const oldSocket = await h.enter(roomCode, host)
    await h.rooms.startGame(roomCode, 1)
    const newSocket = new FakeSocket()

    await h.handler.message(
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
    expect(h.registry.of(oldSocket)).toBeNull()
    expect(h.registry.of(newSocket)?.playerId).toBe(host.userId)
  })

  it('재접속 스냅샷 생성이 실패하면 INTERNAL과 함께 팬아웃에서 뺀다', async () => {
    const { module } = stubModule({
      reconnect: () => {
        throw new Error('라운드 상태 없음')
      },
    })
    h.games.register(module)
    const { roomCode, host } = await h.openRoom()
    const oldSocket = await h.enter(roomCode, host)
    const newSocket = new FakeSocket()

    await h.handler.message(
      newSocket,
      joinFrame(roomCode, { sessionToken: host.sessionToken }, 'reconnect-fail'),
    )

    expect(newSocket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'INTERNAL', refMsgId: 'reconnect-fail' },
    })
    newSocket.clear()
    h.broadcaster.broadcast(roomCode, envelope('state.sync', {}, { roomId: roomCode }))
    expect(newSocket.sent).toHaveLength(0)
    expect(oldSocket.sent.filter((raw) => raw.includes('state.sync'))).toHaveLength(0)
  })

  /* ------------------------------------------------------------ room.ready·reaction */
})
