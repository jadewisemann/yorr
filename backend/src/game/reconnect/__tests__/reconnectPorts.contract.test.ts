import { describe, expect, it } from 'vitest'
import type { RoomService } from '../../../room/roomService.js'
import type { WsRoomSnapshot } from '../../../ws/protocol.js'
import { RoomSessionRegistry } from '../../../ws/registry.js'
import { RealtimeRoomSnapshotService } from '../../../ws/snapshot.js'
import type { GameScoreQueryService } from '../../query/index.js'
import type { RoundTimerService } from '../../round/index.js'
import { InMemoryRoundStateStore, RoundSynchronizationService } from '../../round/index.js'
import type {
  OrphanedRoundStatePort,
  RealtimeRoomSnapshotPort,
  ReconnectRoundStatePort,
  RoundDeadlinePort,
  RoundTimerCancelPort,
  ScoreboardQueryPort,
  SweeperRoomService,
} from '../reconnectPorts.js'
import { PLAYING_PHASE } from '../reconnectPorts.js'

/**
 * 2.8의 좁은 포트들이 **진짜 구현으로 그대로 만족되는지** 고정한다.
 *
 * 존재 이유는 2.5의 `roundPorts.contract.test.ts`와 같다: 어댑터가 없으므로
 * 시그니처가 어긋나면 배선하는 순간(`server.ts`)에야 터진다. 여기서 대입 자체를
 * 테스트로 잡아 그 창을 없앤다.
 */
describe('재접속 포트 ↔ 실제 구현 호환', () => {
  it('RoundSynchronizationService가 라운드 상태 포트 둘을 만족한다', async () => {
    const real = new RoundSynchronizationService(new InMemoryRoundStateStore())
    const roundStates: ReconnectRoundStatePort = real
    const orphans: OrphanedRoundStatePort = real
    await real.initialize('room-a', 3, ['player-a', 'player-b'])

    const state = await roundStates.findByRoomId('room-a')

    expect(state?.roundNumber).toBe(3)
    expect(state?.activePlayerId).toBe('player-a')
    expect(state?.participantOrder).toEqual(['player-a', 'player-b'])
    expect(state?.activeRollCount).toBe(0)
    expect(state?.activeDice).toBeNull()
    expect(state?.activeHeld).toBeNull()

    expect(await orphans.roomIds()).toEqual(['room-a'])
    await orphans.remove('room-a')
    expect(await orphans.roomIds()).toEqual([])
  })

  it('RealtimeRoomSnapshotService가 방 스냅샷 포트를 만족한다', async () => {
    const registry = new RoomSessionRegistry()
    registry.markPhase('room-a', 'playing')
    const real = new RealtimeRoomSnapshotService(stubRoomService(), registry)
    const port: RealtimeRoomSnapshotPort<WsRoomSnapshot> = real

    // WS phase는 소문자다 — 스냅샷 서비스의 PLAYING 판정이 이 값과 같아야 한다.
    expect((await port.snapshot('room-a')).phase).toBe(PLAYING_PHASE)
  })

  /**
   * `RoundTimerService`·`RoomService`는 각각 Redis 의존 협력자가 있어야 만들 수
   * 있으므로 타입 수준으로만 확인한다 — `npm run typecheck`가 이 줄을 검사한다.
   */
  it('RoundTimerService·RoomService·GameScoreQueryService가 나머지 포트를 만족한다(타입 수준)', () => {
    const deadlines: RoundTimerService extends RoundDeadlinePort ? true : false = true
    const cancels: RoundTimerService extends RoundTimerCancelPort ? true : false = true
    const rooms: RoomService extends SweeperRoomService ? true : false = true
    // 2.9는 `ReadonlyMap`을 돌려준다 — 포트가 Map을 받는 이유이자, 여기서 어긋나면
    // 재접속 스냅샷의 점수판이 `{}`로 나가는 회귀의 조기 경보다.
    const scores: GameScoreQueryService extends ScoreboardQueryPort ? true : false = true

    expect([deadlines, cancels, rooms, scores]).toEqual([true, true, true, true])
  })
})

/** 방이 사라진 것처럼 답하게 해 레지스트리 명단 경로만 태운다. */
const stubRoomService = (): RoomService =>
  ({
    getSnapshot: async (roomCode: string) => ({
      roomCode,
      gameCode: null,
      gameId: null,
      hostId: null,
      phase: null,
      capacity: 0,
      players: [],
    }),
  }) as unknown as RoomService
