import { describe, expect, it } from 'vitest'
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
import type { DavinciGameModule } from '../davinciGameModule.js'
import type {
  DavinciCompletionPort,
  DavinciDeadlineScheduler,
  DavinciPresence,
  DavinciRoomSnapshotPort,
  DavinciSessionLookup,
} from '../davinciPorts.js'
import { registryAudience } from '../davinciSockets.js'

/**
 * 좁은 포트들이 **진짜 구현으로 그대로 만족되는지** 고정한다(결투 `duelPorts.contract`와
 * 같은 이유). 어댑터가 없으므로 시그니처가 어긋나면 배선하는 순간에야 터지는데,
 * 그 창을 여기서 없앤다.
 */
describe('다빈치 코드 포트 ↔ 실제 구현 호환', () => {
  it('레지스트리 좌석으로 만든 관객이 좌석마다 따로 보낸다', () => {
    const registry = new RoomSessionRegistry()
    const host = fakeSocket()
    const guest = fakeSocket()
    registry.join('room-a', host, 'player-1', '요르')
    registry.join('room-a', guest, 'player-2', '손님')

    const audience = registryAudience(registry)
    for (const seat of audience.membersOf('room-a')) {
      if (seat.socket === null) continue
      audience.send(seat.socket, {
        type: 'game.davinci_code.state',
        ts: 1,
        payload: { seat: seat.playerId },
        roomId: 'room-a',
      })
    }

    expect(host.sent).toHaveLength(1)
    expect(guest.sent).toHaveLength(1)
    // 좌석마다 payload가 다르다 — 이 게임이 방송기를 쓰지 않는 이유 그 자체다.
    expect(host.sent[0]).toContain('player-1')
    expect(guest.sent[0]).toContain('player-2')
  })

  it('오프라인 좌석은 명단에 남지만 전송에서 걸러진다', () => {
    const registry = new RoomSessionRegistry()
    const socket = fakeSocket()
    registry.join('room-a', socket, 'player-1', '요르')
    registry.markOffline(socket)

    const seats = registryAudience(registry).membersOf('room-a')

    expect(seats).toHaveLength(1)
    expect(seats[0]?.socket).toBeNull()
  })

  it('RoomSessionRegistry가 DavinciPresence·DavinciSessionLookup을 만족한다', () => {
    const real = new RoomSessionRegistry()
    const presence: DavinciPresence = real
    const lookup: DavinciSessionLookup<ClientSocket> = real

    expectRegistryServesSeats({
      markPlaying: (roomId) => presence.markPhase(roomId, 'playing'),
      playerIdOf: (socket) => lookup.of(socket)?.playerId ?? null,
      registry: real,
    })
  })

  it('InMemoryRoundDeadlineScheduler가 DavinciDeadlineScheduler를 만족한다(키가 version이어도)', async () => {
    const port: DavinciDeadlineScheduler = new InMemoryRoundDeadlineScheduler()

    await expectDeadlineFires(port)
  })

  it('타입 수준 대입: 완료 서비스·실시간 스냅샷·게임 모듈', () => {
    // 실제 인스턴스는 Redis·ws가 필요하므로 대입 가능성만 컴파일러로 고정한다.
    const completion = (service: GameCompletionService): DavinciCompletionPort => service
    const snapshots = (
      service: RealtimeRoomSnapshotService,
    ): DavinciRoomSnapshotPort<WsRoomSnapshot> => service
    const module = (davinci: DavinciGameModule): GameModule => davinci

    expect([completion, snapshots, module].every((fn) => typeof fn === 'function')).toBe(true)
  })
})
