import { describe, expect, it } from 'vitest'
import type { RoomService } from '../../../room/roomService.js'
import { RoomBroadcaster } from '../../../ws/broadcaster.js'
import { RoomSessionRegistry } from '../../../ws/registry.js'
import type { RealtimeRoomSnapshotService } from '../../../ws/snapshot.js'
import { fakeSocket } from '../../__tests__/portDoubles.js'
import type { GameCompletionPort } from '../../round/index.js'
import { InMemoryRoundDeadlineScheduler } from '../../round/index.js'
import type {
  CompletionBroadcaster,
  CompletionDeadlineScheduler,
  CompletionPresence,
  CompletionRoomService,
  CompletionSnapshotService,
} from '../completionPorts.js'
import type { GameCompletionService } from '../gameCompletionService.js'

/**
 * 2.7의 좁은 포트들이 **진짜 구현으로 그대로 만족되는지** 고정한다(2.5의
 * `roundPorts.contract.test.ts`와 같은 이유). 어댑터가 없으므로 시그니처가 어긋나면
 * 배선하는 순간(`server.ts`)에야 터지는데, 그 창을 여기서 없앤다.
 *
 * 반대 방향도 같이 고정한다: `GameCompletionService`가 2.5의 `GameCompletionPort`를
 * 만족해야 타이머에 그대로 꽂힌다.
 */
describe('게임 종료 포트 ↔ 실제 구현 호환', () => {
  it('RoomBroadcaster가 CompletionBroadcaster를 만족한다', () => {
    const real = new RoomBroadcaster()
    const port: CompletionBroadcaster = real
    const socket = fakeSocket()
    real.register('room-a', socket)

    port.broadcast('room-a', {
      type: 'game.yacht_dice.game.over',
      ts: 1,
      payload: { rankings: [] },
      roomId: 'room-a',
    })

    expect(JSON.parse(socket.sent[0] as string)).toEqual({
      type: 'game.yacht_dice.game.over',
      ts: 1,
      payload: { rankings: [] },
      roomId: 'room-a',
    })
  })

  it('RoomSessionRegistry가 CompletionPresence를 만족한다', () => {
    const real = new RoomSessionRegistry()
    const port: CompletionPresence = real
    real.join('room-a', fakeSocket(), 'player-a', 'A')

    port.markPhase('room-a', 'finished')

    expect(real.phaseOf('room-a')).toBe('finished')
  })

  it('InMemoryRoundDeadlineScheduler가 CompletionDeadlineScheduler를 만족한다', () => {
    const real = new InMemoryRoundDeadlineScheduler()
    const port: CompletionDeadlineScheduler = real

    // 없는 방을 취소해도 안전해야 한다(전이 직후 무조건 부른다).
    expect(() => port.cancelRoom('room-a')).not.toThrow()
  })

  /** Redis·소켓이 있어야 만들 수 있는 것들은 타입 수준으로만 확인한다. */
  it('RoomService·RealtimeRoomSnapshotService가 포트를 만족한다(타입 수준)', () => {
    const roomServiceSatisfied: RoomService extends CompletionRoomService ? true : false = true
    const snapshotsSatisfied: RealtimeRoomSnapshotService extends CompletionSnapshotService
      ? true
      : false = true

    expect([roomServiceSatisfied, snapshotsSatisfied]).toEqual([true, true])
  })

  /** 이게 깨지면 2.5 타이머가 종료 서비스를 못 받는다. */
  it('GameCompletionService가 2.5의 GameCompletionPort를 만족한다(타입 수준)', () => {
    const satisfied: GameCompletionService extends GameCompletionPort ? true : false = true
    expect(satisfied).toBe(true)
  })
})
