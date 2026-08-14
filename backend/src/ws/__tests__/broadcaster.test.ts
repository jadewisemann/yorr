import { describe, expect, it } from 'vitest'
import { RoomBroadcaster } from '../broadcaster.js'
import { envelope } from '../envelope.js'
import type { ClientSocket } from '../socket.js'

interface FakeSocket extends ClientSocket {
  readyState: number
  readonly sent: string[]
}

const socket = (readyState = 1): FakeSocket => ({
  readyState,
  sent: [],
  send(data: string) {
    this.sent.push(data)
  },
  close() {},
})

describe('RoomBroadcaster', () => {
  it('한 번 직렬화한 같은 프레임을 방 전체가 받는다', () => {
    const broadcaster = new RoomBroadcaster()
    const first = socket()
    const second = socket()
    broadcaster.register('ROOM1', first)
    broadcaster.register('ROOM1', second)

    broadcaster.broadcast(
      'ROOM1',
      envelope('room.player_left', { playerId: 'p1' }, { roomId: 'R' }),
    )

    expect(first.sent).toHaveLength(1)
    expect(first.sent[0]).toBe(second.sent[0])
    expect(JSON.parse(first.sent[0] as string)).toMatchObject({
      type: 'room.player_left',
      roomId: 'R',
      payload: { playerId: 'p1' },
    })
  })

  it('닫힌 소켓은 건너뛰고 전송 실패는 방송을 막지 않는다', () => {
    const broadcaster = new RoomBroadcaster()
    const closed = socket(3)
    const dead: FakeSocket = {
      ...socket(),
      send() {
        throw new Error('socket is gone')
      },
    }
    const alive = socket()
    broadcaster.register('ROOM1', closed)
    broadcaster.register('ROOM1', dead)
    broadcaster.register('ROOM1', alive)

    broadcaster.broadcast('ROOM1', envelope('state.sync', {}))

    expect(closed.sent).toHaveLength(0)
    expect(alive.sent).toHaveLength(1)
  })

  it('등록 해제된 소켓과 다른 방은 받지 않는다', () => {
    const broadcaster = new RoomBroadcaster()
    const left = socket()
    const other = socket()
    broadcaster.register('ROOM1', left)
    broadcaster.register('ROOM2', other)

    broadcaster.unregister(left)
    broadcaster.broadcast('ROOM1', envelope('state.sync', {}))

    expect(left.sent).toHaveLength(0)
    expect(other.sent).toHaveLength(0)
    expect(broadcaster.size('ROOM1')).toBe(0)
  })
})
