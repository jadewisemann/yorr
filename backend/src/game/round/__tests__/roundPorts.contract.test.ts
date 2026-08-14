import { describe, expect, it } from 'vitest'
import type { RoomService } from '../../../room/roomService.js'
import { RoomBroadcaster } from '../../../ws/broadcaster.js'
import { RoomSessionRegistry } from '../../../ws/registry.js'
import type { ClientSocket } from '../../../ws/socket.js'
import { SOCKET_OPEN } from '../../../ws/socket.js'
import type { RoundBroadcaster, RoundPresence, RoundRoomService } from '../roundPorts.js'

/**
 * 2.5의 좁은 포트들이 **진짜 구현으로 그대로 만족되는지** 고정한다.
 *
 * 존재 이유: 라운드 서비스들은 `RoomBroadcaster`·`RoomSessionRegistry`·`RoomService`를
 * 직접 import하지 않는다(도메인이 전송 계층을 모르게, 그리고 2.1이 동시에 고치는
 * 모듈에 컴파일 의존을 만들지 않으려고). 그 대가로 **어댑터가 없으므로 시그니처가
 * 어긋나면 배선하는 순간(server.ts)에야 터진다.** 여기서 대입 자체를 테스트로 잡아
 * 그 창을 없앤다.
 */
describe('라운드 포트 ↔ 실제 구현 호환', () => {
  it('RoomBroadcaster가 RoundBroadcaster를 만족한다', () => {
    const real = new RoomBroadcaster()
    const port: RoundBroadcaster = real
    const socket = fakeSocket()
    real.register('room-a', socket)

    port.broadcast('room-a', {
      type: 'game.yacht_dice.round.start',
      ts: 1,
      payload: { roundNumber: 1 },
      roomId: 'room-a',
    })

    expect(socket.sent).toHaveLength(1)
    expect(JSON.parse(socket.sent[0] as string)).toEqual({
      type: 'game.yacht_dice.round.start',
      ts: 1,
      payload: { roundNumber: 1 },
      roomId: 'room-a',
    })
  })

  it('RoomSessionRegistry가 RoundPresence를 만족한다', () => {
    const real = new RoomSessionRegistry()
    const port: RoundPresence = real
    real.join('room-a', fakeSocket(), 'player-a', 'A')

    expect(port.find('room-a', 'player-a')?.status).toBe('online')
    expect(port.removePlayer('room-a', 'player-a')?.playerId).toBe('player-a')
    // 멱등 — 이미 빠진 좌석은 null이고, 타이머는 그걸로 재방송을 막는다.
    expect(port.removePlayer('room-a', 'player-a')).toBeNull()
    expect(port.find('room-a', 'player-a')).toBeNull()
  })

  /**
   * `RoomService`는 Redis 연결이 있어야 만들 수 있으므로 타입 수준으로만 확인한다.
   * `npm run typecheck`가 이 줄을 검사한다 — 시그니처가 어긋나면 컴파일이 깨진다.
   */
  it('RoomService가 RoundRoomService를 만족한다(타입 수준)', () => {
    const satisfied: RoomService extends RoundRoomService ? true : false = true
    expect(satisfied).toBe(true)
  })
})

interface FakeSocket extends ClientSocket {
  readonly sent: string[]
}

const fakeSocket = (): FakeSocket => ({
  readyState: SOCKET_OPEN,
  sent: [],
  send(data: string) {
    this.sent.push(data)
  },
  close() {},
})
