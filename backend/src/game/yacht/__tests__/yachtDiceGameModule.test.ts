import { beforeEach, describe, expect, it } from 'vitest'
import type { GameStartResult } from '../../../room/roomService.js'
import type { RoomSnapshot } from '../../../room/snapshot.js'
import type { RoomBroadcaster } from '../../../ws/broadcaster.js'
import type { RoomSessionRegistry } from '../../../ws/registry.js'
import { GameCatalog } from '../../catalog.js'
import { GameModuleRegistry } from '../../module.js'
import type { RoundSynchronizationService } from '../../round/index.js'
import { YachtDiceGameModule } from '../yachtDiceGameModule.js'
import { YachtTurnActionService } from '../yachtTurnActionService.js'
import {
  type FakeRealtimeSnapshots,
  FakeReconnectSnapshots,
  FakeRoundTimer,
  type FakeScoreBoardStore,
  FakeSocket,
  NO_HELD,
} from './testDoubles.js'
import { OTHER_ROOM, ROOM, TS, useYachtModule } from './yachtDiceHarness.js'

describe('YachtDiceGameModule', () => {
  const h = useYachtModule()

  // 하네스가 매 검사마다 새로 세운 것을 그대로 받는다. 이름을 바꾸지 않는 이유는
  // 검사 본문이 무엇을 다루는지가 이름에 남아야 하기 때문이다.
  let registry: RoomSessionRegistry
  let broadcaster: RoomBroadcaster
  let rounds: RoundSynchronizationService
  let timers: FakeRoundTimer
  let scoreBoards: FakeScoreBoardStore
  let realtimeSnapshots: FakeRealtimeSnapshots
  let reconnectSnapshots: FakeReconnectSnapshots
  let module: YachtDiceGameModule
  let playerA: FakeSocket
  let playerB: FakeSocket
  beforeEach(() => {
    ;({
      registry,
      broadcaster,
      rounds,
      timers,
      scoreBoards,
      realtimeSnapshots,
      reconnectSnapshots,
      module,
      playerA,
      playerB,
    } = h)
  })
  const { seat, envelope, rollEnvelope, submitEnvelope, errorOf } = h

  /* ----------------------------------------------------------- round.submit */

  it('제출 결과와 요청 msgId를 그대로 공유 턴 진행 경로에 넘긴다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a', 'player-b'])
    seat(playerA, 'player-a')
    seat(playerB, 'player-b')
    await module.handle(playerA, rollEnvelope(1, 'roll-a'))

    await module.handle(playerA, await submitEnvelope('player-a-message'))

    const first = timers.advanced.at(-1)
    expect(first?.msgId).toBe('player-a-message')
    expect(first?.result.score?.playerId).toBe('player-a')
    expect(first?.result.round.completedRound).toBeNull()
    expect(first?.result.round.state.activePlayerId).toBe('player-b')

    await module.handle(playerB, rollEnvelope(1, 'roll-b'))
    await module.handle(playerB, await submitEnvelope('player-b-message'))

    const last = timers.advanced.at(-1)
    expect(last?.msgId).toBe('player-b-message')
    expect(last?.result.round.completedRound?.roundNumber).toBe(1)
    expect(last?.result.round.state.roundNumber).toBe(2)
  })

  it('점수 저장 실패는 INTERNAL이고 제출로 표시되지 않으며 턴도 진행되지 않는다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a'])
    seat(playerA, 'player-a')
    await module.handle(playerA, rollEnvelope(1, 'roll-a'))
    const submit = await submitEnvelope('failed-score-message')
    scoreBoards.failWith('STORE_FAILURE')
    playerA.reset()

    await module.handle(playerA, submit)

    expect(playerA.last().type).toBe('error')
    expect(errorOf(playerA)).toMatchObject({
      code: 'INTERNAL',
      refMsgId: 'failed-score-message',
    })
    const state = await rounds.findByRoomId(ROOM)
    expect(state?.roundNumber).toBe(1)
    expect(state?.submittedPlayerIds).toEqual([])
    expect(timers.advanced).toHaveLength(0)
  })

  it('턴 주인이 아닌 제출은 NOT_YOUR_TURN이고 점수 확정을 시도하지 않는다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a', 'player-b'])
    seat(playerB, 'player-b')

    await module.handle(playerB, await submitEnvelope('out-of-turn-message'))

    expect(errorOf(playerB)).toMatchObject({
      code: 'NOT_YOUR_TURN',
      refMsgId: 'out-of-turn-message',
    })
    expect(scoreBoards.confirmed).toHaveLength(0)
    expect((await rounds.findByRoomId(ROOM))?.activePlayerId).toBe('player-a')
  })

  it('서버 주사위와 다른 dice를 제출하면 INVALID_MESSAGE다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a'])
    seat(playerA, 'player-a')
    await module.handle(playerA, rollEnvelope(1, 'roll-a'))
    playerA.reset()

    await module.handle(
      playerA,
      envelope('round.submit', { roundNumber: 1, dice: [6, 6, 6, 6, 6], category: 'yacht' }, 'lie'),
    )

    expect(errorOf(playerA)).toMatchObject({ code: 'INVALID_MESSAGE', refMsgId: 'lie' })
    expect(scoreBoards.confirmed).toHaveLength(0)
  })

  it('모르는 카테고리는 INVALID_MESSAGE다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a'])
    seat(playerA, 'player-a')
    await module.handle(playerA, rollEnvelope(1, 'roll-a'))
    const state = await rounds.findByRoomId(ROOM)
    playerA.reset()

    await module.handle(
      playerA,
      envelope(
        'round.submit',
        { roundNumber: 1, dice: [...(state?.activeDice ?? [])], category: 'jackpot' },
        'bad-category',
      ),
    )

    expect(errorOf(playerA)).toMatchObject({
      code: 'INVALID_MESSAGE',
      refMsgId: 'bad-category',
    })
  })

  /* -------------------------------------------------------------- roomId 검증 */

  it('세션의 방이 아닌 roomId로 온 제출은 NOT_IN_ROOM이다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a'])
    registry.join(OTHER_ROOM, playerA, 'player-a', 'Player A')
    broadcaster.register(OTHER_ROOM, playerA)

    await module.handle(playerA, await submitEnvelope('wrong-room-message'))

    expect(errorOf(playerA)).toMatchObject({
      code: 'NOT_IN_ROOM',
      refMsgId: 'wrong-room-message',
    })
  })

  it('roomId가 없으면 NOT_IN_ROOM이다', async () => {
    seat(playerA, 'player-a')

    // roomId 필드 자체가 없는 봉투 — 기본값을 채우지 않도록 직접 만든다.
    await module.handle(playerA, { type: 'dice.roll', ts: TS, payload: {}, msgId: 'no-room' })

    expect(errorOf(playerA)).toMatchObject({ code: 'NOT_IN_ROOM', refMsgId: 'no-room' })
  })

  it('방에 앉지 않은 소켓은 NOT_IN_ROOM이다', async () => {
    const stranger = new FakeSocket()

    await module.handle(stranger, rollEnvelope(1, 'stranger-roll'))

    expect(errorOf(stranger)).toMatchObject({ code: 'NOT_IN_ROOM', refMsgId: 'stranger-roll' })
  })

  /* --------------------------------------------------------------- 라우팅 */

  it('5메시지만 받는다', () => {
    for (const event of ['dice.roll', 'dice.hold', 'dice.shake', 'dice.throw', 'round.submit']) {
      expect(module.handles(event)).toBe(true)
    }
    for (const event of ['dice.broadcast', 'round.start', 'state.sync', 'room.join', '']) {
      expect(module.handles(event)).toBe(false)
    }
  })

  it('레지스트리 dispatch가 접두사를 벗겨 이 모듈로 넘긴다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a'])
    seat(playerA, 'player-a')
    const games = new GameModuleRegistry(new GameCatalog())
    games.register(module)

    const handled = await games.dispatch('YACHT_DICE', playerA, {
      type: 'game.yacht_dice.dice.roll',
      ts: TS,
      payload: { roundNumber: 1, rollCount: 1, held: NO_HELD },
      roomId: ROOM,
      msgId: 'dispatched',
    })

    expect(handled).toBe(true)
    expect(playerA.last().type).toBe('game.yacht_dice.dice.broadcast')
    // 다른 게임 네임스페이스는 이 모듈에 닿지 않는다.
    expect(
      await games.dispatch('YACHT_DICE', playerA, {
        type: 'game.duel.dice.roll',
        ts: TS,
        payload: {},
        roomId: ROOM,
        msgId: 'cross',
      }),
    ).toBe(false)
  })

  /* ------------------------------------------------------------- 수명주기 */

  const startResult = (hostId: string, ...playerIds: string[]): GameStartResult => {
    const snapshot: RoomSnapshot = {
      roomCode: ROOM,
      gameCode: 'YACHT_DICE',
      gameId: 'game-a',
      hostId,
      phase: 'PLAYING',
      capacity: 6,
      players: playerIds.map((playerId) => ({
        playerId,
        nickname: playerId,
        score: 0,
        kind: 'HUMAN' as const,
      })),
    }
    return { gameId: 'game-a', snapshot }
  }

  it('start는 host 우선 순서로 초기화하고 phase를 playing으로 옮긴 뒤 state.sync를 쏜다', async () => {
    seat(playerA, 'player-a')
    seat(playerB, 'player-b')

    await module.start(ROOM, startResult('player-b', 'player-a', 'player-b', 'player-c'))

    const state = await rounds.findByRoomId(ROOM)
    // host가 맨 앞, 나머지는 Redis 명단 순서 유지(안정 정렬).
    expect(state?.participantOrder).toEqual(['player-b', 'player-a', 'player-c'])
    expect(state?.roundNumber).toBe(1)
    // ⚠️ 이 한 줄이 없으면 끊긴 플레이어가 offline이 아니라 player_left가 된다.
    expect(registry.phaseOf(ROOM)).toBe('playing')
    expect(playerA.last().type).toBe('game.yacht_dice.state.sync')
    expect(realtimeSnapshots.calls).toEqual([ROOM])
    expect(timers.started).toHaveLength(1)
    expect(timers.started[0]?.state.activePlayerId).toBe('player-b')
  })

  it('start는 잔여 상태를 먼저 지운다 — 재시작이 SETNX에 막히지 않는다', async () => {
    await rounds.initialize(ROOM, 1, ['old-player'])

    await module.start(ROOM, startResult('player-a', 'player-a'))

    expect((await rounds.findByRoomId(ROOM))?.participantOrder).toEqual(['player-a'])
  })

  it('start가 실패하면 스스로 reset하고 예외를 올린다', async () => {
    seat(playerA, 'player-a')
    registry.markPhase(ROOM, 'playing')
    const failure = new Error('boom')
    timers.start = async () => {
      throw failure
    }

    await expect(module.start(ROOM, startResult('player-a', 'player-a'))).rejects.toBe(failure)

    // reset이 돌았다: 상태 삭제 + phase 되돌림 + state.sync.
    expect(await rounds.findByRoomId(ROOM)).toBeUndefined()
    expect(registry.phaseOf(ROOM)).toBe('waiting')
    expect(timers.cancelledRooms).toContain(ROOM)
    expect(playerA.last().type).toBe('game.yacht_dice.state.sync')
  })

  it('reset은 타이머·상태를 버리고 phase를 waiting으로 되돌린다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a'])
    seat(playerA, 'player-a')
    registry.markPhase(ROOM, 'playing')

    await module.reset(ROOM)

    expect(timers.cancelledRooms).toEqual([ROOM])
    expect(await rounds.findByRoomId(ROOM)).toBeUndefined()
    expect(registry.phaseOf(ROOM)).toBe('waiting')
    expect(playerA.last().type).toBe('game.yacht_dice.state.sync')
  })

  it('reconnect는 스냅샷을 만든 뒤에 오프라인 결석을 리셋한다', async () => {
    const order: string[] = []
    const orderedTimers = new FakeRoundTimer()
    orderedTimers.clearOfflineMisses = (roomId, playerId) => {
      order.push('clear')
      FakeRoundTimer.prototype.clearOfflineMisses.call(orderedTimers, roomId, playerId)
    }
    const orderedSnapshots = new FakeReconnectSnapshots()
    const original = orderedSnapshots.snapshot.bind(orderedSnapshots)
    orderedSnapshots.snapshot = async (roomId, playerId) => {
      order.push('snapshot')
      return original(roomId, playerId)
    }
    const scoped = new YachtDiceGameModule({
      rounds,
      timers: orderedTimers,
      actions: new YachtTurnActionService({
        rounds,
        timers: orderedTimers,
        broadcaster,
        submissions: {
          submit: async () => {
            throw new Error('unused')
          },
        },
      }),
      seats: registry,
      realtimeSnapshots,
      reconnectSnapshots: orderedSnapshots,
      broadcaster,
    })

    const snapshot = await scoped.reconnect(ROOM, 'player-a')

    expect(snapshot.game).toEqual({ roundNumber: 1 })
    expect(order).toEqual(['snapshot', 'clear'])
    expect(orderedTimers.clearedMisses).toEqual([{ roomId: ROOM, playerId: 'player-a' }])
  })

  it('스냅샷 조립이 실패하면 오프라인 결석은 남는다', async () => {
    reconnectSnapshots.failure = new Error('snapshot failed')

    await expect(module.reconnect(ROOM, 'player-a')).rejects.toThrow('snapshot failed')

    expect(timers.clearedMisses).toEqual([])
  })

  it('resume은 미완료 상태가 있을 때만 타이머를 재무장한다', async () => {
    await module.resume(ROOM)
    expect(timers.started).toHaveLength(0)

    await rounds.initialize(ROOM, 1, ['player-a'], 1)
    await module.resume(ROOM)
    expect(timers.started).toHaveLength(1)

    // 마지막 라운드를 만료시켜 finished로 만든다.
    await rounds.expire(ROOM, 1, 'player-a')
    expect((await rounds.findByRoomId(ROOM))?.finished).toBe(true)
    await module.resume(ROOM)
    expect(timers.started).toHaveLength(1)
  })

  /**
   * `rehydrate`가 `resume`과 갈라져 있는 것이 계약이다(deploy/PLAN.md PR 6).
   *
   * `resume`은 **새 25초**를 준다(멈춰 둔 시계를 다시 켜는 경로 — 그때 원래 마감을
   * 되살리면 돌아온 사람의 턴이 그 자리에서 만료된다). `rehydrate`는 **저장된 마감**을
   * 되살린다(프로세스만 죽었고 판은 그대로다). 둘이 같은 메서드를 부르게 되면 한쪽이
   * 반드시 틀리는데, 타입도 다른 테스트도 그것을 잡지 못한다.
   */
  it('rehydrate는 start가 아니라 저장된 마감으로 되살린다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a'], 1)

    await module.rehydrate(ROOM)

    expect(timers.resumed).toHaveLength(1)
    expect(timers.started).toHaveLength(0)
  })

  it('되살릴 마감 기록이 없으면 던진다 — 호출자가 그 방을 닫는다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a'], 1)
    timers.resumable = false

    await expect(module.rehydrate(ROOM)).rejects.toThrow('되살릴 턴 마감 기록이 없습니다')
  })

  it('진행 중이라던 방에 라운드 상태가 없으면 던진다', async () => {
    await expect(module.rehydrate(ROOM)).rejects.toThrow('야추 라운드 상태가 없습니다')
    expect(timers.resumed).toHaveLength(0)
  })

  /** 종료 전이가 실패한 채 남은 방이다. 되살리면 끝난 게임이 계속 돌아간다. */
  it('라운드가 이미 끝난 방은 던진다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a'], 1)
    await rounds.expire(ROOM, 1, 'player-a')

    await expect(module.rehydrate(ROOM)).rejects.toThrow('이미 끝난 방입니다')
  })

  it('pause는 타이머만 끊고 상태는 남긴다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a'])

    await module.pause(ROOM)

    expect(timers.cancelledRooms).toEqual([ROOM])
    expect(await rounds.findByRoomId(ROOM)).toBeDefined()
  })

  it('close는 타이머와 상태를 함께 버린다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a'])

    await module.close(ROOM)

    expect(timers.cancelledRooms).toEqual([ROOM])
    expect(await rounds.findByRoomId(ROOM)).toBeUndefined()
  })

  it('hasState가 빈 방 유예 선택의 근거다', async () => {
    expect(await module.hasState(ROOM)).toBe(false)
    await rounds.initialize(ROOM, 1, ['player-a'])
    expect(await module.hasState(ROOM)).toBe(true)
  })

  it('removePlayer는 타이머의 단일 이탈 경로로 넘긴다', async () => {
    await module.removePlayer(ROOM, 'player-a')

    expect(timers.removed).toEqual([{ roomId: ROOM, playerId: 'player-a' }])
  })
})
