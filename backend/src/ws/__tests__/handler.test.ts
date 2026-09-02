import { expect, it, vi } from 'vitest'
import { describeRedis, useRedis } from '../../../test/redisHarness.js'
import type { GameModule } from '../../game/module.js'
import { envelope } from '../envelope.js'
import { ACTIVE_GAME_GRACE_MS, EMPTY_LOBBY_GRACE_MS, GameSocketHandler } from '../handler.js'
import { HeartbeatMonitor } from '../heartbeat.js'
import { RealtimeRoomSnapshotService } from '../snapshot.js'
import { FakeSocket, frame, joinFrame, stubModule, useWsHandler } from './wsHarness.js'

describeRedis('GameSocketHandler', () => {
  const redis = useRedis()
  const h = useWsHandler(redis)

  /** 게임 모듈을 등록한 방에 호스트로 들어간다. 모듈 위임 검사들이 여기서 출발한다. */
  const enterWith = async (module: GameModule) => {
    h.games.register(module)
    const { roomCode, host } = await h.openRoom()
    return { roomCode, host, socket: await h.enter(roomCode, host) }
  }

  it('연결 직후 sys.connected로 하트비트 규칙을 알린다', () => {
    const socket = new FakeSocket()

    h.handler.connected(socket)

    expect(socket.only()).toMatchObject({
      type: 'sys.connected',
      payload: { protocolVersion: 1, heartbeatIntervalMs: 30_000 },
    })
    // 방 밖 메시지라 roomId·msgId는 실리지 않는다.
    expect(socket.only().roomId).toBeUndefined()
  })

  it('ping은 하트비트를 먼저 갱신하고 pong을 보낸다', async () => {
    const socket = new FakeSocket()
    h.handler.connected(socket)
    socket.clear()
    const recordPing = vi.spyOn(h.heartbeat, 'recordPing')

    await h.handler.message(socket, frame('sys.ping', { clientTs: 1 }))

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
    // 이 검사만 시계를 손에 쥔 하트비트가 필요하므로 게이트웨이를 따로 세운다.
    const handler = new GameSocketHandler({
      registry: h.registry,
      broadcaster: h.broadcaster,
      snapshots: new RealtimeRoomSnapshotService(h.rooms, h.registry),
      heartbeat: monitor,
      users: h.users,
      rooms: h.rooms,
      closeScheduler: h.closeScheduler,
      games: h.games,
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

    await h.handler.message(socket, 'not-json')

    expect(socket.only()).toMatchObject({ type: 'error', payload: { code: 'INVALID_MESSAGE' } })
    expect(socket.only().payload).not.toHaveProperty('refMsgId')
    expect(socket.closeCode).toBeNull()
  })

  /* ----------------------------------------------------------------------- room.join */

  /**
   * 유예가 끝나 방이 닫힌 뒤의 "이어서 하기". 메모리에만 있는 유령 방에 입장시키면
   * 대기실 화면에서 게임 시작이 404로 실패하는 막힌 상태가 된다.
   */
  it('room.ready는 상태를 저장하지 않고 본인 포함 전체에 릴레이한다', async () => {
    const { roomCode, host } = await h.openRoom()
    const socket = await h.enter(roomCode, host)

    await h.handler.message(socket, frame('room.ready', { ready: true }, { msgId: 'ready-a' }))

    expect(socket.only()).toMatchObject({
      type: 'room.ready_changed',
      roomId: roomCode,
      payload: { playerId: host.userId, ready: true },
    })
  })

  it('방 밖에서 보낸 room.ready·reaction은 NOT_IN_ROOM이다', async () => {
    const readySocket = new FakeSocket()
    const reactionSocket = new FakeSocket()

    await h.handler.message(readySocket, frame('room.ready', { ready: true }))
    await h.handler.message(reactionSocket, frame('reaction.send', { reaction: 'like' }))

    expect(readySocket.only().payload).toMatchObject({ code: 'NOT_IN_ROOM' })
    expect(reactionSocket.only().payload).toMatchObject({ code: 'NOT_IN_ROOM' })
  })

  it('reaction.send는 본인 포함 방 전체에 뿌리고, 모르는 값은 거부한다', async () => {
    const { roomCode, host } = await h.openRoom()
    const socket = await h.enter(roomCode, host)

    await h.handler.message(socket, frame('reaction.send', { reaction: 'gg' }))

    expect(socket.only()).toMatchObject({
      type: 'reaction.broadcast',
      roomId: roomCode,
      payload: { playerId: host.userId, reaction: 'gg' },
    })

    socket.clear()
    await h.handler.message(socket, frame('reaction.send', { reaction: 'boo' }, { msgId: 'bad' }))

    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'INVALID_MESSAGE', refMsgId: 'bad' },
    })
  })
  it('방에 들어가기 전 게임 메시지는 AUTH_REQUIRED다', async () => {
    const stranger = new FakeSocket()

    await h.handler.message(
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
    const { roomCode, socket } = await enterWith(module)

    await h.handler.message(
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
    const { socket } = await enterWith(module)

    await h.handler.message(socket, frame('game.duel.dice.roll', {}, { msgId: 'cross' }))
    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'INVALID_MESSAGE', refMsgId: 'cross' },
    })

    socket.clear()
    await h.handler.message(socket, frame('game.yacht_dice.dice.spin', {}, { msgId: 'unknown' }))
    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'INVALID_MESSAGE', refMsgId: 'unknown' },
    })
    expect(handled).toHaveLength(0)
  })

  /** 모듈이 아직 없는 게임의 방도 대기실은 돌아간다 — 게임 메시지만 거절된다. */
  it('등록된 모듈이 없으면 게임 메시지는 INVALID_MESSAGE다', async () => {
    const { roomCode, host } = await h.openRoom()
    const socket = await h.enter(roomCode, host)

    await h.handler.message(socket, frame('game.yacht_dice.dice.roll', {}, { msgId: 'no-module' }))

    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'INVALID_MESSAGE', refMsgId: 'no-module' },
    })
  })

  /* -------------------------------------------------------------- 끊김·방 폐쇄 */
  it('대기실에서 끊기면 명단에서 빠지고 남은 사람이 player_left를 받는다', async () => {
    const { roomCode, host, hostSocket, guest, guestSocket } = await h.enterPair()

    await h.handler.closed(guestSocket)

    expect(h.registry.snapshot(roomCode).players.map((player) => player.playerId)).toEqual([
      host.userId,
    ])
    expect(hostSocket.only()).toMatchObject({
      type: 'room.player_left',
      payload: { playerId: guest.userId },
    })
  })

  it('게임 중 끊김은 좌석을 남기고 presence.update{offline}만 보낸다', async () => {
    const { roomCode, hostSocket, guest, guestSocket } = await h.enterPair()
    h.registry.markPhase(roomCode, 'playing')
    hostSocket.clear()

    await h.handler.closed(guestSocket)

    expect(h.registry.snapshot(roomCode).players).toHaveLength(2)
    expect(h.registry.find(roomCode, guest.userId)?.status).toBe('offline')
    expect(hostSocket.only()).toMatchObject({
      type: 'presence.update',
      payload: { playerId: guest.userId, status: 'offline' },
    })
    expect(hostSocket.types()).not.toContain('room.player_left')
    expect(h.closeScheduler.isPending(roomCode)).toBe(false)
  })

  it('대기실의 마지막 소켓이 빠지면 30초 유예를 준다', async () => {
    const { module, calls } = stubModule({ hasState: false })
    const { roomCode, socket } = await enterWith(module)

    await h.handler.closed(socket)

    expect(h.closeScheduler.isPending(roomCode)).toBe(true)
    expect(h.closeScheduler.lastDelayMs).toBe(EMPTY_LOBBY_GRACE_MS)
    // 마감 타이머는 즉시 끊는다 — 빈 방이 25초마다 자동 진행되면 안 된다.
    expect(calls).toContain('pause')
  })

  /** 유예 기준은 phase가 아니라 "잃을 것이 있는지"다 — 30초는 앱 전환·화면 잠금에 너무 짧다. */
  it('진행 상태가 남아 있으면 10분 유예를 준다', async () => {
    const { module } = stubModule({ hasState: true })
    const { roomCode, socket } = await enterWith(module)

    await h.handler.closed(socket)

    expect(h.closeScheduler.lastDelayMs).toBe(ACTIVE_GAME_GRACE_MS)
    // 진행 상태는 아직 살려둔다 — 새로고침으로 돌아올 수 있다.
    expect((await h.rooms.getSnapshot(roomCode)).phase).toBe('LOBBY')
  })

  it('유예 안에 아무도 안 돌아오면 방을 닫는다', async () => {
    const { module, calls } = stubModule({ hasState: true })
    const { roomCode, socket } = await enterWith(module)
    await h.handler.closed(socket)

    await h.closeScheduler.fire(roomCode)

    expect(calls).toContain('close')
    expect((await h.rooms.getSnapshot(roomCode)).phase).toBeNull()
  })

  it('유예 중 누가 돌아오면 예약을 취소하고 타이머를 재개한다', async () => {
    const { module, calls } = stubModule({ hasState: true })
    h.games.register(module)
    const { roomCode, host } = await h.openRoom()
    const first = await h.enter(roomCode, host)
    await h.handler.closed(first)
    expect(h.closeScheduler.isPending(roomCode)).toBe(true)

    // 새로고침으로 돌아온다 — 같은 세션 토큰, 새 소켓.
    const second = new FakeSocket()
    await h.handler.message(second, joinFrame(roomCode, { sessionToken: host.sessionToken }))

    expect(h.closeScheduler.isPending(roomCode)).toBe(false)
    expect(calls).toContain('resume')
    expect((await h.rooms.getSnapshot(roomCode)).phase).toBe('LOBBY')
  })

  it('다른 사람이 남아 있으면 아무것도 예약하지 않는다', async () => {
    const { module, calls } = stubModule({ hasState: true })
    h.games.register(module)
    const { roomCode, host } = await h.openRoom()
    const hostSocket = await h.enter(roomCode, host)
    const guest = await h.users.createGuest('참가자')
    await h.rooms.join(roomCode, { userId: guest.userId, nickname: guest.nickname, type: 'GUEST' })
    await h.enter(roomCode, guest)

    await h.handler.closed(hostSocket)

    expect(h.closeScheduler.isPending(roomCode)).toBe(false)
    expect(calls).not.toContain('pause')
  })

  /**
   * 게임 중 명시 퇴장은 명단 제거·턴 순서 정리·방송이 한 덩어리라 게임 모듈이 맡는다
   * (소켓 종료는 offline 처리로 빠지므로 그 경로와 구분해야 한다). 핸들러의 책임은
   * 팬아웃에서 빼고 그쪽에 위임하는 것까지다.
   */
  it('게임 중 room.leave는 게임 모듈의 이탈 경로로 넘긴다', async () => {
    const { module, calls } = stubModule({ hasState: true })
    const { roomCode, host, socket } = await enterWith(module)
    h.registry.markPhase(roomCode, 'playing')

    await h.handler.message(socket, frame('room.leave', {}, { msgId: 'leave-a' }))

    expect(calls).toContain(`removePlayer:${host.userId}`)
    // 팬아웃에서도 빠졌는지 — 이후 방 방송이 본인에게 가지 않아야 한다.
    socket.clear()
    h.broadcaster.broadcast(roomCode, envelope('state.sync', {}, { roomId: roomCode }))
    expect(socket.sent).toHaveLength(0)
  })

  it('대기실 room.leave는 명단에서 빼고 player_left를 방에 알린다', async () => {
    const { roomCode, hostSocket, guest, guestSocket } = await h.enterPair()

    await h.handler.message(guestSocket, frame('room.leave', {}))

    expect(h.registry.of(guestSocket)).toBeNull()
    expect(hostSocket.only()).toMatchObject({
      type: 'room.player_left',
      payload: { playerId: guest.userId },
    })
    // WS 퇴장은 Redis 명단을 바꾸지 않는다 — 유예 후 close가 정리한다.
    expect((await h.rooms.getSnapshot(roomCode)).players).toHaveLength(2)
  })
})
