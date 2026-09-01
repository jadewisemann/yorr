import { describe, expect, it } from 'vitest'
import type { RoomService } from '../../../room/roomService.js'
import { roomNotFound } from '../../../room/snapshot.js'
import { RoomSessionRegistry } from '../../../ws/registry.js'
import { RealtimeRoomSnapshotService } from '../../../ws/snapshot.js'
import type { ClientSocket } from '../../../ws/socket.js'
import { SOCKET_OPEN } from '../../../ws/socket.js'
import { RoundState } from '../../round/index.js'
import { GameReconnectSnapshotService } from '../gameReconnectSnapshotService.js'
import { isReconnectSnapshotError } from '../reconnectErrors.js'
import type {
  ReconnectRoundState,
  ReconnectRoundStatePort,
  RoundDeadlinePort,
  ScoreboardQueryPort,
  ScoreboardsByPlayer,
} from '../reconnectPorts.js'
import type { YachtDiceState } from '../yachtDiceState.js'

/**
 * **실시간 병합 스냅샷은 진짜 구현**(`RealtimeRoomSnapshotService` +
 * `RoomSessionRegistry`)을 쓰고 라운드·마감·점수만 대역으로 넣는다 — 스냅샷의
 * 방 부분과 게임 부분이 실제로 합쳐지는지가 이 티켓의 계약이기 때문이다.
 */
describe('GameReconnectSnapshotService', () => {
  it('현재 라운드·마감·턴 순서·점수판을 스냅샷에 싣는다', async () => {
    const deadline = Date.parse('2026-07-29T08:00:25Z')
    const score = { categories: { ones: 3 }, upperSubtotal: 3, upperBonus: 0, total: 3 }
    const service = snapshotService({
      round: RoundState.start(4, ['player-a', 'player-b']),
      deadline,
      scores: { 'player-a': score },
    })

    const snapshot = await service.snapshot('room-a', 'player-a')
    const game = gameOf(snapshot)

    expect(game.roundNumber).toBe(4)
    expect(game.activePlayerId).toBe('player-a')
    expect(game.roundDeadline).toBe(deadline)
    expect(game.turnOrder).toEqual(['player-a', 'player-b'])
    expect(game.scores).toEqual({ 'player-a': score })
    // 아직 굴리지 않은 턴 — 굴림 0회, 주사위·KEEP은 없음(직렬화에서 빠진다).
    expect(game.rollCount).toBe(0)
    expect(game.dice).toBeUndefined()
    expect(game.held).toBeUndefined()
  })

  /**
   * 굴림 진행이 빠지면 재접속한 클라이언트가 0회부터 다시 세고, 그 다음 dice.roll이
   * 서버의 activeRollCount와 어긋나 거부된다.
   */
  it('현재 턴의 굴림 진행(rollCount·dice·held)을 싣는다', async () => {
    const twoRollsIn = RoundState.start(4, ['player-a', 'player-b'])
      .recordRoll('player-a', 4, 1, noHeld, [6, 6, 3, 2, 1])
      .recordRoll('player-a', 4, 2, [true, true, false, false, false], [1, 1, 5, 4, 4])
    const service = snapshotService({
      round: twoRollsIn,
      deadline: Date.parse('2026-07-29T08:00:25Z'),
      scores: {},
    })

    const game = gameOf(await service.snapshot('room-a', 'player-a'))

    expect(game.rollCount).toBe(2)
    // KEEP한 두 자리는 첫 굴림 값이 그대로 유지된 채 내려간다.
    expect(game.dice).toEqual([6, 6, 5, 4, 4])
    expect(game.held).toEqual([true, true, false, false, false])
  })

  /**
   * `dice`·`held`는 값이 없을 때 **키 자체가 빠져야** 한다
   * (`@JsonInclude(NON_NULL)` 자리) — null로 실으면 프론트가 "굴렸는데 값이 없다"로 읽는다.
   */
  it('첫 굴림 전에는 dice·held 키가 직렬화에서 빠진다', async () => {
    const service = snapshotService({
      round: RoundState.start(1, ['player-a']),
      deadline: 1,
      scores: {},
    })

    const wire = JSON.parse(JSON.stringify(await service.snapshot('room-a', 'player-a')))

    expect(Object.hasOwn(wire.game, 'dice')).toBe(false)
    expect(Object.hasOwn(wire.game, 'held')).toBe(false)
    expect(wire.game.rollCount).toBe(0)
  })

  /**
   * 프론트 리듀서의 전제다: `game` 없는 스냅샷이 와야
   * 클라이언트가 로컬 game을 보존한다(docs/design/reconnect.md 「규칙」).
   */
  it('진행 중이 아닌 방은 방 스냅샷 그대로 — game을 붙이지 않는다', async () => {
    const service = snapshotService({
      round: RoundState.start(1, ['player-a']),
      deadline: 1,
      scores: {},
      phase: 'waiting',
    })

    const snapshot = await service.snapshot('room-a', 'player-a')

    expect(snapshot.phase).toBe('waiting')
    expect('game' in snapshot).toBe(false)
  })

  it('진행 중인데 라운드 상태가 없으면 ROUND_NOT_INITIALIZED로 실패한다', async () => {
    const service = snapshotService({ round: undefined, deadline: 1, scores: {} })

    const error = await service.snapshot('room-a', 'player-a').catch((thrown: unknown) => thrown)

    expect(isReconnectSnapshotError(error, 'ROUND_NOT_INITIALIZED')).toBe(true)
  })

  /** pause로 타이머가 멈춘 방에 재접속하면 실제로 도달한다(reconnect.md 「알려진 틈」). */
  it('진행 중인데 활성 마감이 없으면 DEADLINE_NOT_FOUND로 실패한다', async () => {
    const service = snapshotService({
      round: RoundState.start(1, ['player-a']),
      deadline: undefined,
      scores: {},
    })

    const error = await service.snapshot('room-a', 'player-a').catch((thrown: unknown) => thrown)

    expect(isReconnectSnapshotError(error, 'DEADLINE_NOT_FOUND')).toBe(true)
  })

  /**
   * **직렬화에서 생기는 함정**. 조회 계층은 playerId 순서를
   * 보존하려고 `ReadonlyMap`을 돌려주는데 `JSON.stringify(new Map())`은 `{}`다 —
   * 그대로 실으면 재접속 클라이언트의 점수판이 통째로 사라진다.
   */
  it('Map으로 온 점수판을 순서를 지킨 평범한 객체로 옮긴다', async () => {
    const service = snapshotService({
      round: RoundState.start(1, ['player-a']),
      deadline: 1,
      scores: new Map<string, unknown>([
        ['player-a', { total: 3 }],
        ['player-b', { total: 7 }],
      ]),
    })

    const wire = JSON.parse(JSON.stringify(await service.snapshot('room-a', 'player-a')))

    expect(wire.game.scores).toEqual({ 'player-a': { total: 3 }, 'player-b': { total: 7 } })
    expect(Object.keys(wire.game.scores)).toEqual(['player-a', 'player-b'])
  })

  it('점수판 조회에 요청자 playerId를 그대로 넘긴다', async () => {
    const calls: [string, string][] = []
    const service = snapshotService({
      round: RoundState.start(1, ['player-a']),
      deadline: 1,
      scores: {},
      onScoreQuery: (roomId, requesterId) => calls.push([roomId, requesterId]),
    })

    await service.snapshot('room-a', 'player-b')

    expect(calls).toEqual([['room-a', 'player-b']])
  })
})

const noHeld: readonly boolean[] = [false, false, false, false, false]

interface Fixture {
  readonly round: ReconnectRoundState | undefined
  readonly deadline: number | undefined
  readonly scores: ScoreboardsByPlayer
  readonly phase?: 'waiting' | 'playing'
  readonly onScoreQuery?: (roomId: string, requesterId: string) => void
}

/**
 * 방이 이미 사라진 것처럼 보이게 하는 `RoomService` 대역 — 아래
 * `mock(RoomService.class)` 자리다. 그러면 `RealtimeRoomSnapshotService`가
 * 레지스트리 명단으로 답하므로 소켓·phase만 준비하면 된다.
 */
const stubRoomService = (): RoomService =>
  ({
    getSnapshot: async (roomId: string) => roomNotFound(roomId),
  }) as unknown as RoomService

const snapshotService = (fixture: Fixture) => {
  const registry = new RoomSessionRegistry()
  registry.join('room-a', fakeSocket(), 'player-a', 'Player A')
  registry.markPhase('room-a', fixture.phase ?? 'playing')

  const roundStates: ReconnectRoundStatePort = {
    findByRoomId: async () => fixture.round,
  }
  const deadlines: RoundDeadlinePort = {
    currentDeadline: () => fixture.deadline,
  }
  const scoreboards: ScoreboardQueryPort = {
    getScoreboards: (roomId, requesterId) => {
      fixture.onScoreQuery?.(roomId, requesterId)
      return fixture.scores
    },
  }

  return new GameReconnectSnapshotService({
    realtimeSnapshots: new RealtimeRoomSnapshotService(stubRoomService(), registry),
    roundStates,
    deadlines,
    scoreboards,
  })
}

const gameOf = (snapshot: { readonly game?: unknown }): YachtDiceState => {
  const game = snapshot.game
  if (game === undefined) throw new Error('스냅샷에 game이 없습니다')
  return game as YachtDiceState
}

const fakeSocket = (): ClientSocket => ({
  readyState: SOCKET_OPEN,
  send() {},
  close() {},
})
