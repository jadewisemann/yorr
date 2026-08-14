import { beforeEach, describe, expect, it } from 'vitest'
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
 * 음성 시그널링 — backend-java `RoomSessionRegistryVoiceTest`와
 * `GameWebSocketHandlerTest`의 voice 케이스를 옮긴 것이다.
 * 실제 소켓 위 검증은 `gateway.test.ts`가 맡는다(계약 문서: docs/design/voice.md).
 */

const bareSocket = (): ClientSocket => ({ readyState: 1, send: () => {}, close: () => {} })

class FakeSocket implements ClientSocket {
  readyState = 1
  readonly sent: string[] = []

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = 3
  }

  messages(): OutboundEnvelope[] {
    return this.sent.map((raw) => JSON.parse(raw) as OutboundEnvelope)
  }

  types(): string[] {
    return this.messages().map((message) => message.type)
  }

  only(): OutboundEnvelope {
    expect(this.sent).toHaveLength(1)
    return this.messages()[0] as OutboundEnvelope
  }

  last(type: string): OutboundEnvelope | undefined {
    return this.messages().findLast((message) => message.type === type)
  }

  clear(): void {
    this.sent.length = 0
  }
}

/* ------------------------------------------------------- 음성 명단(레지스트리) */

describe('음성 명단(RoomSessionRegistry)', () => {
  let registry: RoomSessionRegistry

  beforeEach(() => {
    registry = new RoomSessionRegistry()
  })

  /** voice.peers가 증분이 아니라 전체 스냅샷이라 호출부가 그대로 방송할 수 있어야 한다. */
  it('joinVoice는 들어온 사람이 아니라 전체 명단을 돌려준다', () => {
    expect(registry.joinVoice('room-a', 'player-a')).toEqual(['player-a'])

    expect(registry.joinVoice('room-a', 'player-b')).toEqual(
      expect.arrayContaining(['player-a', 'player-b']),
    )
    expect(registry.joinVoice('room-a', 'player-b')).toHaveLength(2)
  })

  it('중복 voice.join은 무해하다', () => {
    registry.joinVoice('room-a', 'player-a')

    // 재연결 직후의 중복 join이 명단을 망가뜨리면 안 된다.
    expect(registry.joinVoice('room-a', 'player-a')).toEqual(['player-a'])
  })

  it('음성 채널을 떠나도 방에는 남는다', () => {
    const socket = bareSocket()
    registry.join('room-a', socket, 'player-a', 'Player A')
    registry.joinVoice('room-a', 'player-a')

    registry.leaveVoice('room-a', 'player-a')

    // 마이크만 내려놓았을 뿐이다.
    expect(registry.voiceMembersOf('room-a')).toEqual([])
    expect(registry.find('room-a', 'player-a')).not.toBeNull()
  })

  /** 소켓 종료 경로는 통화 중이었는지 모른 채 불릴 수 있다. */
  it('통화에 없던 사람을 빼도 무해하다', () => {
    expect(registry.leaveVoice('room-a', 'player-a')).toEqual([])
    expect(registry.voiceMembersOf('room-a')).toEqual([])
  })

  it('방의 마지막 사람이 나가면 음성 명단도 함께 버린다', () => {
    const socket = bareSocket()
    registry.join('room-a', socket, 'player-a', 'Player A')
    registry.joinVoice('room-a', 'player-a')

    registry.remove(socket)

    // 방 코드가 재사용돼도 이전 통화 명단이 남지 않아야 한다.
    expect(registry.voiceMembersOf('room-a')).toEqual([])
  })

  it('음성 명단은 방마다 격리된다', () => {
    registry.joinVoice('room-a', 'player-a')
    registry.joinVoice('room-b', 'player-b')

    expect(registry.voiceMembersOf('room-a')).toEqual(['player-a'])
    expect(registry.voiceMembersOf('room-b')).toEqual(['player-b'])
  })
})

/* ------------------------------------------------------ 시그널링(핸들러 프로토콜) */

describeRedis('음성 시그널링(GameSocketHandler)', () => {
  const redis = useRedis()

  let rooms: RoomService
  let users: UserService
  let registry: RoomSessionRegistry
  let broadcaster: RoomBroadcaster
  let handler: GameSocketHandler

  const noopCloseScheduler: RoomCloseScheduler = {
    schedule: () => {},
    cancel: () => false,
  }

  beforeEach(() => {
    rooms = new RoomService(redis())
    users = new UserService(redis())
    registry = new RoomSessionRegistry()
    broadcaster = new RoomBroadcaster()
    handler = new GameSocketHandler({
      registry,
      broadcaster,
      snapshots: new RealtimeRoomSnapshotService(rooms, registry),
      heartbeat: new HeartbeatMonitor({ startScheduler: false }),
      users,
      rooms,
      closeScheduler: noopCloseScheduler,
      games: new GameModuleRegistry(),
    })
  })

  const frame = (type: string, payload: unknown, msgId?: string): string =>
    JSON.stringify({ type, ts: Date.now(), payload, roomId: 'room-a', ...(msgId ? { msgId } : {}) })

  /** REST(`POST /rooms`)로 방과 좌석을 만든 상태 — WS join의 전제 조건이다. */
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

  it('voice.join은 방 전원에게 전체 명단을 방송한다', async () => {
    const { roomCode, host } = await openRoom()
    const guest = await addGuest(roomCode, '참가자')
    const hostSocket = await enter(roomCode, host)
    const guestSocket = await enter(roomCode, guest)
    hostSocket.clear()
    guestSocket.clear()

    await handler.message(hostSocket, frame('voice.join', {}, 'voice-join-a'))

    // 통화에 참여하지 않은 사람도 받아야 한다 — 누가 통화 중인지 보고 들어갈지 판단한다.
    expect(hostSocket.only()).toMatchObject({
      type: 'voice.peers',
      roomId: roomCode,
      payload: { peers: [host.userId] },
    })
    expect(guestSocket.only()).toMatchObject({
      type: 'voice.peers',
      payload: { peers: [host.userId] },
    })
  })

  it('voice.leave는 명단에서만 빼고 방에는 남긴다', async () => {
    const { roomCode, host } = await openRoom()
    const hostSocket = await enter(roomCode, host)
    await handler.message(hostSocket, frame('voice.join', {}))
    hostSocket.clear()

    await handler.message(hostSocket, frame('voice.leave', {}))

    expect(hostSocket.only()).toMatchObject({ type: 'voice.peers', payload: { peers: [] } })
    expect(registry.voiceMembersOf(roomCode)).toEqual([])
    expect(registry.find(roomCode, host.userId)).not.toBeNull()
  })

  it('voice.signal은 지목된 상대에게만 가고 from은 서버가 채운다', async () => {
    const { roomCode, host } = await openRoom()
    const guest = await addGuest(roomCode, '참가자')
    const hostSocket = await enter(roomCode, host)
    const guestSocket = await enter(roomCode, guest)
    hostSocket.clear()
    guestSocket.clear()

    await handler.message(
      hostSocket,
      frame(
        'voice.signal',
        {
          to: guest.userId,
          // from을 클라이언트가 우겨 넣어도 서버가 무시해야 한다(사칭 방지).
          from: 'player-임의조작',
          data: { kind: 'candidate', candidate: { candidate: 'host udp' } },
        },
        'voice-signal-a',
      ),
    )

    expect(guestSocket.only()).toMatchObject({
      type: 'voice.signaled',
      roomId: roomCode,
      payload: {
        from: host.userId,
        data: { kind: 'candidate', candidate: { candidate: 'host udp' } },
      },
    })
    expect(guestSocket.sent[0]).not.toContain('player-임의조작')
    // 두 피어 사이의 협상이라 방 전체로 나가면 안 된다.
    expect(hostSocket.sent).toHaveLength(0)
  })

  it('부재 상대에게 보낸 시그널은 오류 없이 버린다', async () => {
    const { roomCode, host } = await openRoom()
    const hostSocket = await enter(roomCode, host)

    await handler.message(
      hostSocket,
      frame('voice.signal', { to: 'player-이미나감', data: { kind: 'candidate' } }, 'orphan'),
    )

    // 협상 중 이탈은 정상 상황이다 — 오류로 만들면 나갈 때마다 남은 쪽에 잡음이 쌓인다.
    expect(hostSocket.sent).toHaveLength(0)
  })

  /** 대상 조회가 방 스코프라 다른 방으로는 시그널이 새지 않는다. */
  it('다른 방 사람에게는 시그널이 가지 않는다', async () => {
    const { roomCode, host } = await openRoom()
    const hostSocket = await enter(roomCode, host)
    const other = await openRoom()
    const otherSocket = await enter(other.roomCode, other.host)

    await handler.message(
      hostSocket,
      frame('voice.signal', { to: other.host.userId, data: { kind: 'description' } }),
    )

    expect(otherSocket.sent).toHaveLength(0)
    expect(hostSocket.sent).toHaveLength(0)
  })

  it('to가 비었거나 data가 없으면 INVALID_MESSAGE다', async () => {
    const { roomCode, host } = await openRoom()
    const socket = await enter(roomCode, host)

    await handler.message(socket, frame('voice.signal', { to: '  ', data: {} }, 'blank-to'))
    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'INVALID_MESSAGE', refMsgId: 'blank-to' },
    })

    socket.clear()
    await handler.message(socket, frame('voice.signal', { to: 'player-b' }, 'no-data'))
    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'INVALID_MESSAGE', refMsgId: 'no-data' },
    })
  })

  it('방에 들어가기 전 voice.*는 NOT_IN_ROOM이다', async () => {
    const joinSocket = new FakeSocket()
    const leaveSocket = new FakeSocket()
    const signalSocket = new FakeSocket()

    await handler.message(joinSocket, frame('voice.join', {}, 'stranger-join'))
    await handler.message(leaveSocket, frame('voice.leave', {}))
    await handler.message(signalSocket, frame('voice.signal', { to: 'x', data: {} }))

    expect(joinSocket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'NOT_IN_ROOM', refMsgId: 'stranger-join' },
    })
    expect(leaveSocket.only().payload).toMatchObject({ code: 'NOT_IN_ROOM' })
    expect(signalSocket.only().payload).toMatchObject({ code: 'NOT_IN_ROOM' })
  })

  /** 탭을 닫으면 voice.leave 없이 끊긴다 — 이게 정상 경로다. */
  it('소켓이 끊기면 명단에서 빠지고 남은 사람이 새 명단을 받는다', async () => {
    const { roomCode, host } = await openRoom()
    const guest = await addGuest(roomCode, '참가자')
    const hostSocket = await enter(roomCode, host)
    const guestSocket = await enter(roomCode, guest)
    await handler.message(hostSocket, frame('voice.join', {}))
    await handler.message(guestSocket, frame('voice.join', {}))
    guestSocket.clear()

    await handler.closed(hostSocket)

    expect(registry.voiceMembersOf(roomCode)).toEqual([guest.userId])
    // 남은 사람이 이미 없는 피어에게 계속 offer를 보내지 않도록 명단을 다시 뿌린다.
    expect(guestSocket.last('voice.peers')).toMatchObject({ payload: { peers: [guest.userId] } })
    // 음성 정리가 먼저이므로 방 이탈 방송도 그대로 나간다.
    expect(guestSocket.types()).toContain('room.player_left')
  })

  /** 게임 중 끊김은 좌석을 남기지만(offline) 통화에서는 빠져야 한다. */
  it('게임 중 끊겨도 음성 명단에서는 빠진다', async () => {
    const { roomCode, host } = await openRoom()
    const guest = await addGuest(roomCode, '참가자')
    const hostSocket = await enter(roomCode, host)
    const guestSocket = await enter(roomCode, guest)
    await handler.message(hostSocket, frame('voice.join', {}))
    registry.markPhase(roomCode, 'playing')
    guestSocket.clear()

    await handler.closed(hostSocket)

    expect(registry.voiceMembersOf(roomCode)).toEqual([])
    expect(guestSocket.last('voice.peers')).toMatchObject({ payload: { peers: [] } })
    expect(registry.find(roomCode, host.userId)?.status).toBe('offline')
  })

  it('room.leave도 음성 명단을 먼저 정리한다', async () => {
    const { roomCode, host } = await openRoom()
    const guest = await addGuest(roomCode, '참가자')
    const hostSocket = await enter(roomCode, host)
    const guestSocket = await enter(roomCode, guest)
    await handler.message(hostSocket, frame('voice.join', {}))
    guestSocket.clear()

    await handler.message(hostSocket, frame('room.leave', {}))

    expect(registry.voiceMembersOf(roomCode)).toEqual([])
    expect(guestSocket.last('voice.peers')).toMatchObject({ payload: { peers: [] } })
  })

  /**
   * 재접속(소켓 교체)은 통화에서 빠지는 것이 아니다. 교체된 옛 소켓의 close가 늦게
   * 도착해도 레지스트리가 이미 그 소켓을 잊었으므로 명단은 그대로여야 한다.
   */
  it('소켓이 교체돼도 음성 명단은 유지된다', async () => {
    const { roomCode, host } = await openRoom()
    const guest = await addGuest(roomCode, '참가자')
    const hostSocket = await enter(roomCode, host)
    const guestSocket = await enter(roomCode, guest)
    await handler.message(hostSocket, frame('voice.join', {}))
    guestSocket.clear()

    const replacement = await enter(roomCode, host)
    await handler.closed(hostSocket)

    expect(registry.voiceMembersOf(roomCode)).toEqual([host.userId])
    expect(guestSocket.types()).not.toContain('voice.peers')
    expect(replacement.types()).not.toContain('voice.peers')
  })

  /** 통화 중이 아니었으면 아무 것도 방송하지 않는다(끊길 때마다 빈 명단이 날아가면 안 된다). */
  it('통화하지 않던 사람이 끊겨도 voice.peers는 나가지 않는다', async () => {
    const { roomCode, host } = await openRoom()
    const guest = await addGuest(roomCode, '참가자')
    const hostSocket = await enter(roomCode, host)
    const guestSocket = await enter(roomCode, guest)
    guestSocket.clear()

    await handler.closed(hostSocket)

    expect(guestSocket.types()).not.toContain('voice.peers')
  })
})
