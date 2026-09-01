import { describe, expect, it } from 'vitest'
import type { GameStartResult, RoomService } from '../../../room/roomService.js'
import { RoomBroadcaster } from '../../../ws/broadcaster.js'
import type { WsRoomSnapshot } from '../../../ws/protocol.js'
import { RoomSessionRegistry } from '../../../ws/registry.js'
import type { RealtimeRoomSnapshotService } from '../../../ws/snapshot.js'
import { type ClientSocket, SOCKET_OPEN } from '../../../ws/socket.js'
import type { GameCompletionService } from '../../completion/index.js'
import type { GameModule } from '../../module.js'
import { InMemoryRoundDeadlineScheduler } from '../../round/index.js'
import type { SocketMembership } from '../../socketGameModule.js'
import type { PingPongGameModule } from '../pingPongGameModule.js'
import type { PingPongGameStart } from '../pingPongGameService.js'
import type {
  PingPongBroadcaster,
  PingPongCompletionPort,
  PingPongDeadlineScheduler,
  PingPongPresence,
  PingPongRoomService,
  PingPongSnapshotService,
} from '../pingPongPorts.js'

/**
 * 3.4의 좁은 포트들이 **진짜 구현으로 그대로 만족되는지** 고정한다(2.5·2.7의
 * 같은 이름 테스트와 같은 이유). 어댑터가 없으므로 시그니처가 어긋나면
 * 배선하는 순간(`server.ts`)에야 터지는데, 그 창을 여기서 없앤다.
 */
describe('탁구 포트 ↔ 실제 구현 호환', () => {
  it('RoomBroadcaster가 PingPongBroadcaster를 만족한다', () => {
    const real = new RoomBroadcaster()
    const port: PingPongBroadcaster = real
    const socket = fakeSocket()
    real.register('room-a', socket)

    port.broadcast('room-a', {
      type: 'game.ping_pong.state',
      ts: 1,
      payload: { version: 1 },
      roomId: 'room-a',
    })

    expect(JSON.parse(socket.sent[0] as string)).toEqual({
      type: 'game.ping_pong.state',
      ts: 1,
      payload: { version: 1 },
      roomId: 'room-a',
    })
  })

  it('RoomSessionRegistry가 PingPongPresence·SocketMembership을 만족한다', () => {
    const real = new RoomSessionRegistry()
    const presence: PingPongPresence = real
    const membership: SocketMembership = real
    const socket = fakeSocket()
    real.join('room-a', socket, 'player-a', 'A')

    presence.markPhase('room-a', 'playing')
    expect(real.phaseOf('room-a')).toBe('playing')
    expect(membership.of(socket)?.playerId).toBe('player-a')

    expect(presence.removePlayer('room-a', 'player-a')?.playerId).toBe('player-a')
    // 이미 없는 좌석은 null — `room.player_left`를 두 번 쏘지 않는 근거다.
    expect(presence.removePlayer('room-a', 'player-a')).toBeNull()
  })

  it('InMemoryRoundDeadlineScheduler가 PingPongDeadlineScheduler를 만족한다', () => {
    const real = new InMemoryRoundDeadlineScheduler()
    const port: PingPongDeadlineScheduler = real

    // 두 번째 인자가 version(1부터)이라 스케줄러의 `roundNumber >= 1` 검증을 통과한다.
    expect(() => port.schedule('room-a', 1, Date.now() + 60_000, () => {})).not.toThrow()
    expect(() => port.cancelRoom('room-a')).not.toThrow()
  })

  /** Redis·소켓이 있어야 만들 수 있는 것들은 타입 수준으로만 확인한다. */
  it('RoomService·RealtimeRoomSnapshotService·GameCompletionService가 포트를 만족한다(타입 수준)', () => {
    const roomServiceSatisfied: RoomService extends PingPongRoomService ? true : false = true
    const snapshotsSatisfied: RealtimeRoomSnapshotService extends PingPongSnapshotService<WsRoomSnapshot>
      ? true
      : false = true
    const completionSatisfied: GameCompletionService extends PingPongCompletionPort ? true : false =
      true

    expect([roomServiceSatisfied, snapshotsSatisfied, completionSatisfied]).toEqual([
      true,
      true,
      true,
    ])
  })

  /** START Lua 결과가 서비스의 좁은 입력 모양을 그대로 만족해야 배선이 성립한다. */
  it('GameStartResult가 PingPongGameStart를 만족하고 모듈이 GameModule을 만족한다(타입 수준)', () => {
    const startSatisfied: GameStartResult extends PingPongGameStart ? true : false = true
    const moduleSatisfied: PingPongGameModule extends GameModule ? true : false = true

    expect([startSatisfied, moduleSatisfied]).toEqual([true, true])
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
