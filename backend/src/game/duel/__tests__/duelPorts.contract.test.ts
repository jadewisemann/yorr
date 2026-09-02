import { describe, expect, it } from 'vitest'
import { RoomBroadcaster } from '../../../ws/broadcaster.js'
import type { WsRoomSnapshot } from '../../../ws/protocol.js'
import { RoomSessionRegistry } from '../../../ws/registry.js'
import type { RealtimeRoomSnapshotService } from '../../../ws/snapshot.js'
import type { ClientSocket } from '../../../ws/socket.js'
import {
  expectDeadlineFires,
  expectRegistryServesSeats,
  fakeSocket,
} from '../../__tests__/portDoubles.js'
import type { GameCompletionService } from '../../completion/index.js'
import type { GameModule } from '../../module.js'
import { InMemoryRoundDeadlineScheduler } from '../../round/index.js'
import type { DuelGameModule } from '../duelGameModule.js'
import type {
  DuelBroadcaster,
  DuelCompletionPort,
  DuelDeadlineScheduler,
  DuelPresence,
  DuelRoomSnapshotPort,
  DuelSessionLookup,
} from '../duelPorts.js'

/**
 * 3.3의 좁은 포트들이 **진짜 구현으로 그대로 만족되는지** 고정한다(2.5·2.7의
 * 같은 이름 테스트와 같은 이유). 어댑터가 없으므로 시그니처가 어긋나면 배선하는
 * 순간(`server.ts`)에야 터지는데, 그 창을 여기서 없앤다.
 */
describe('결투 포트 ↔ 실제 구현 호환', () => {
  it('RoomBroadcaster가 DuelBroadcaster를 만족한다', () => {
    const real = new RoomBroadcaster()
    const port: DuelBroadcaster = real
    const socket = fakeSocket()
    real.register('room-a', socket)

    port.broadcast('room-a', {
      type: 'game.duel.state',
      ts: 1,
      payload: { version: 1 },
      roomId: 'room-a',
    })

    expect(socket.sent).toHaveLength(1)
  })

  it('RoomSessionRegistry가 DuelPresence·DuelSessionLookup을 만족한다', () => {
    const real = new RoomSessionRegistry()
    const presence: DuelPresence = real
    const lookup: DuelSessionLookup<ClientSocket> = real

    expectRegistryServesSeats({
      markPlaying: (roomId) => presence.markPhase(roomId, 'playing'),
      playerIdOf: (socket) => lookup.of(socket)?.playerId ?? null,
      registry: real,
    })
  })

  it('InMemoryRoundDeadlineScheduler가 DuelDeadlineScheduler를 만족한다(키가 version이어도)', async () => {
    const port: DuelDeadlineScheduler = new InMemoryRoundDeadlineScheduler()

    await expectDeadlineFires(port)
  })

  it('타입 수준 대입: 완료 서비스·실시간 스냅샷·게임 모듈', () => {
    // 실제 인스턴스는 Redis·ws가 필요하므로 대입 가능성만 컴파일러로 고정한다.
    const completion = (service: GameCompletionService): DuelCompletionPort => service
    const snapshots = (
      service: RealtimeRoomSnapshotService,
    ): DuelRoomSnapshotPort<WsRoomSnapshot> => service
    const module = (duel: DuelGameModule): GameModule => duel

    expect([completion, snapshots, module].every((fn) => typeof fn === 'function')).toBe(true)
  })
})
