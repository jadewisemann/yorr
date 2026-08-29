import { beforeEach, expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../test/redisHarness.js'
import { GameModuleRegistry } from '../../game/module.js'
import type { RoomCloseScheduler } from '../../room/closeScheduler.js'
import { RoomService } from '../../room/roomService.js'
import { type GuestSession, UserService } from '../../user/session.js'
import { RoomBroadcaster } from '../broadcaster.js'
import type { OutboundEnvelope } from '../envelope.js'
import { GameSocketHandler } from '../handler.js'
import { HeartbeatMonitor } from '../heartbeat.js'
import { RoomSessionRegistry } from '../registry.js'
import { RealtimeRoomSnapshotService } from '../snapshot.js'
import type { ClientSocket } from '../socket.js'

/**
 * 컨트롤러 링크 시그널링 — 삭제된 `voice.test.ts`의 릴레이 케이스를 옮긴 것이다.
 * 서버가 검증해야 하는 것은 **누구에게 가는가와 from을 누가 채우는가**뿐이다
 * (계약 문서: docs/design/controller-signal.md).
 */

class FakeSocket implements ClientSocket {
  readyState = 1
  readonly sent: string[] = []

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = 3
  }

  only(): OutboundEnvelope {
    expect(this.sent).toHaveLength(1)
    return JSON.parse(this.sent[0] as string) as OutboundEnvelope
  }

  clear(): void {
    this.sent.length = 0
  }
}

describeRedis('컨트롤러 링크 시그널링(GameSocketHandler)', () => {
  const redis = useRedis()

  let rooms: RoomService
  let users: UserService
  let registry: RoomSessionRegistry
  let handler: GameSocketHandler

  const noopCloseScheduler: RoomCloseScheduler = {
    schedule: () => {},
    cancel: () => false,
  }

  beforeEach(() => {
    rooms = new RoomService(redis())
    users = new UserService(redis())
    registry = new RoomSessionRegistry()
    handler = new GameSocketHandler({
      registry,
      broadcaster: new RoomBroadcaster(),
      snapshots: new RealtimeRoomSnapshotService(rooms, registry),
      heartbeat: new HeartbeatMonitor({ startScheduler: false }),
      users,
      rooms,
      closeScheduler: noopCloseScheduler,
      games: new GameModuleRegistry(),
    })
  })

  const frame = (payload: unknown, msgId?: string): string =>
    JSON.stringify({
      type: 'ctrl.signal',
      ts: Date.now(),
      payload,
      roomId: 'room-a',
      ...(msgId ? { msgId } : {}),
    })

  const openRoom = async (): Promise<{ roomCode: string; host: GuestSession }> => {
    const host = await users.createGuest('호스트')
    const roomCode = await rooms.createRoom(6, host.userId, 'YACHT_DICE')
    await rooms.join(roomCode, { userId: host.userId, nickname: host.nickname, type: 'GUEST' })
    return { roomCode, host }
  }

  const addGuest = async (roomCode: string, nickname: string): Promise<GuestSession> => {
    const guest = await users.createGuest(nickname)
    await rooms.join(roomCode, { userId: guest.userId, nickname: guest.nickname, type: 'GUEST' })
    return guest
  }

  const enter = async (roomCode: string, guest: GuestSession): Promise<FakeSocket> => {
    const socket = new FakeSocket()
    await handler.message(
      socket,
      JSON.stringify({
        type: 'room.join',
        ts: Date.now(),
        payload: { roomId: roomCode, sessionToken: guest.sessionToken },
      }),
    )
    socket.clear()
    return socket
  }

  it('지목된 상대에게만 가고 from은 서버가 채운다', async () => {
    const { roomCode, host } = await openRoom()
    const guest = await addGuest(roomCode, '컨트롤러')
    const hostSocket = await enter(roomCode, host)
    const guestSocket = await enter(roomCode, guest)
    hostSocket.clear()
    guestSocket.clear()

    await handler.message(
      hostSocket,
      frame(
        {
          to: guest.userId,
          // from을 클라이언트가 우겨 넣어도 서버가 무시해야 한다(사칭 방지).
          from: 'player-임의조작',
          data: { kind: 'ctrl.candidate', candidate: { candidate: 'host udp' } },
        },
        'ctrl-a',
      ),
    )

    expect(guestSocket.only()).toMatchObject({
      type: 'ctrl.signaled',
      roomId: roomCode,
      payload: {
        from: host.userId,
        data: { kind: 'ctrl.candidate', candidate: { candidate: 'host udp' } },
      },
    })
    expect(guestSocket.sent[0]).not.toContain('player-임의조작')
    // 두 피어 사이의 협상이라 방 전체로 나가면 안 된다.
    expect(hostSocket.sent).toHaveLength(0)
  })

  it('서버는 data를 열지 않는다 — 모르는 모양도 그대로 전달한다', async () => {
    const { roomCode, host } = await openRoom()
    const guest = await addGuest(roomCode, '컨트롤러')
    const hostSocket = await enter(roomCode, host)
    const guestSocket = await enter(roomCode, guest)
    guestSocket.clear()

    // 브라우저가 규격을 늘리거나 클라이언트가 갈래를 추가해도 서버는 안 바뀌어야 한다.
    await handler.message(hostSocket, frame({ to: guest.userId, data: { kind: '미래의갈래' } }))

    expect(guestSocket.only()).toMatchObject({
      type: 'ctrl.signaled',
      payload: { data: { kind: '미래의갈래' } },
    })
  })

  it('부재 상대에게 보낸 시그널은 오류 없이 버린다', async () => {
    const { roomCode, host } = await openRoom()
    const hostSocket = await enter(roomCode, host)

    await handler.message(hostSocket, frame({ to: 'player-이미나감', data: {} }, 'orphan'))

    // 협상 중 이탈은 정상 상황이다 — 오류로 만들면 나갈 때마다 남은 쪽에 잡음이 쌓인다.
    expect(hostSocket.sent).toHaveLength(0)
  })

  it('다른 방 사람에게는 시그널이 가지 않는다', async () => {
    const { roomCode, host } = await openRoom()
    const hostSocket = await enter(roomCode, host)
    const other = await openRoom()
    const otherSocket = await enter(other.roomCode, other.host)

    await handler.message(hostSocket, frame({ to: other.host.userId, data: {} }))

    expect(otherSocket.sent).toHaveLength(0)
    expect(hostSocket.sent).toHaveLength(0)
  })

  it('to가 비었거나 data가 없으면 INVALID_MESSAGE다', async () => {
    const { roomCode, host } = await openRoom()
    const socket = await enter(roomCode, host)

    await handler.message(socket, frame({ to: '  ', data: {} }, 'blank-to'))
    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'INVALID_MESSAGE', refMsgId: 'blank-to' },
    })

    socket.clear()
    await handler.message(socket, frame({ to: 'player-b' }, 'no-data'))
    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'INVALID_MESSAGE', refMsgId: 'no-data' },
    })
  })

  it('방에 들어오기 전에 보내면 NOT_IN_ROOM이다', async () => {
    const socket = new FakeSocket()

    await handler.message(socket, frame({ to: 'player-b', data: {} }, 'outside'))

    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'NOT_IN_ROOM', refMsgId: 'outside' },
    })
  })
})
