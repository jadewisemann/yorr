import { describe, expect, it } from 'vitest'
import { RoomBroadcaster } from '../../../ws/broadcaster.js'
import type { WsRoomSnapshot } from '../../../ws/protocol.js'
import { RoomSessionRegistry } from '../../../ws/registry.js'
import type { RealtimeRoomSnapshotService } from '../../../ws/snapshot.js'
import { SOCKET_OPEN } from '../../../ws/socket.js'
import { fakeSocket } from '../../__tests__/portDoubles.js'
import type { GameModule } from '../../module.js'
import type { GameReconnectSnapshotService } from '../../reconnect/index.js'
import {
  InMemoryRoundStateStore,
  type RoundStateStore,
  type RoundSubmissionResult,
  RoundSynchronizationService,
  type RoundTimerService,
} from '../../round/index.js'
import type { ScoreRoundSubmissionService } from '../../score/index.js'
import type { RedisYachtDiceStateStore } from '../redisYachtDiceStateStore.js'
import type { YachtDiceGameModule } from '../yachtDiceGameModule.js'
import type {
  YachtBroadcaster,
  YachtClientSocket,
  YachtRealtimeSnapshots,
  YachtReconnectSnapshots,
  YachtRoundService,
  YachtRoundTimer,
  YachtScoreSubmission,
  YachtSeatRegistry,
} from '../yachtPorts.js'

/**
 * 3.1의 좁은 포트들이 **진짜 구현으로 그대로 만족되는지** 고정한다 —
 * 2.5 `roundPorts.contract.test.ts`·2.6 `scorePorts.contract.test.ts`와 같은 이유:
 * 어댑터가 없으므로 시그니처가 어긋나면 **배선하는 순간(`server.ts`)에야** 터진다.
 * 여기서 대입을 테스트로 잡아 그 창을 없앤다.
 *
 * Redis·타이머 의존이 있어 인스턴스를 만들 수 없는 것은 타입 수준(`extends`)으로
 * 확인한다 — `npx tsc --noEmit`이 그 줄을 검사한다.
 */
describe('야추 포트 ↔ 실제 구현 호환', () => {
  it('RoomBroadcaster가 YachtBroadcaster를 만족한다', () => {
    const real = new RoomBroadcaster()
    const port: YachtBroadcaster = real
    const socket = fakeSocket()
    real.register('room-a', socket)

    port.broadcast('room-a', {
      type: 'game.yacht_dice.dice.broadcast',
      ts: 1,
      payload: { playerId: 'player-a' },
      roomId: 'room-a',
      msgId: 'roll-a',
    })

    expect(JSON.parse(socket.sent[0] as string)).toEqual({
      type: 'game.yacht_dice.dice.broadcast',
      ts: 1,
      payload: { playerId: 'player-a' },
      roomId: 'room-a',
      msgId: 'roll-a',
    })
  })

  it('RoomSessionRegistry가 YachtSeatRegistry를 만족한다(좌석 조회 + phase 마킹)', () => {
    const real = new RoomSessionRegistry()
    const port: YachtSeatRegistry = real
    const socket = fakeSocket()
    real.join('room-a', socket, 'player-a', 'A')

    expect(port.of(socket)).toMatchObject({ playerId: 'player-a', roomId: 'room-a' })
    // 이 경로가 없으면 모듈의 start가 phase를 옮길 수 없다(1.5·2.1이 남긴 구멍).
    port.markPhase('room-a', 'playing')
    expect(real.phaseOf('room-a')).toBe('playing')
    port.markPhase('room-a', 'waiting')
    expect(real.phaseOf('room-a')).toBe('waiting')
  })

  it('RoundSynchronizationService가 YachtRoundService를 만족한다', async () => {
    const real = new RoundSynchronizationService(new InMemoryRoundStateStore())
    const port: YachtRoundService = real

    await port.initialize('room-a', 1, ['player-a'])
    expect((await port.findByRoomId('room-a'))?.roundNumber).toBe(1)
    const rolled = await port.recordRoll('room-a', 'player-a', {
      roundNumber: 1,
      rollCount: 1,
      held: [false, false, false, false, false],
    })
    expect(rolled.activeRollCount).toBe(1)
    const held = await port.recordHold('room-a', 'player-a', {
      roundNumber: 1,
      held: [true, false, false, false, false],
    })
    expect(held.activeHeld).toEqual([true, false, false, false, false])
    expect(await port.remove('room-a')).toBe(true)
  })

  it('ClientSocket이 YachtClientSocket을 만족한다', () => {
    const socket: YachtClientSocket = fakeSocket()
    socket.send('{}')
    expect(socket.readyState).toBe(SOCKET_OPEN)
  })

  /* --------------------------------- 인스턴스를 만들 수 없는 것은 타입 수준으로 */

  it('RoundTimerService가 YachtRoundTimer를 만족한다(타입 수준)', () => {
    const satisfied: RoundTimerService extends YachtRoundTimer ? true : false = true
    expect(satisfied).toBe(true)
  })

  it('ScoreRoundSubmissionService가 YachtScoreSubmission을 만족한다(타입 수준)', () => {
    const satisfied: ScoreRoundSubmissionService<RoundSubmissionResult> extends YachtScoreSubmission
      ? true
      : false = true
    expect(satisfied).toBe(true)
  })

  it('RealtimeRoomSnapshotService가 YachtRealtimeSnapshots를 만족한다(타입 수준)', () => {
    const satisfied: RealtimeRoomSnapshotService extends YachtRealtimeSnapshots<WsRoomSnapshot>
      ? true
      : false = true
    expect(satisfied).toBe(true)
  })

  /**
   * 2.8의 스냅샷 서비스는 `S | (S & {game})`을 돌려주지만 둘 다 `S`에 대입 가능하므로
   * 포트를 만족한다 — 모듈의 `reconnect`가 `WsRoomSnapshot`을 약속하는 근거다.
   */
  it('GameReconnectSnapshotService가 YachtReconnectSnapshots를 만족한다(타입 수준)', () => {
    const satisfied: GameReconnectSnapshotService<WsRoomSnapshot> extends YachtReconnectSnapshots<WsRoomSnapshot>
      ? true
      : false = true
    expect(satisfied).toBe(true)
  })

  it('RedisYachtDiceStateStore가 2.4의 RoundStateStore를 만족한다(타입 수준)', () => {
    const satisfied: RedisYachtDiceStateStore extends RoundStateStore ? true : false = true
    expect(satisfied).toBe(true)
  })

  it('YachtDiceGameModule이 2.1의 GameModule을 만족한다(타입 수준)', () => {
    const satisfied: YachtDiceGameModule extends GameModule ? true : false = true
    expect(satisfied).toBe(true)
  })
})
