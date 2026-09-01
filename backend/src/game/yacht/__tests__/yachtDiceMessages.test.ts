import { beforeEach, describe, expect, it } from 'vitest'
import type { RoundSynchronizationService } from '../../round/index.js'
import type { YachtDiceGameModule } from '../yachtDiceGameModule.js'
import { type FakeRoundTimer, type FakeSocket, NO_HELD } from './testDoubles.js'
import { ROOM, useYachtModule } from './yachtDiceHarness.js'

describe('YachtDiceGameModule — 주사위 메시지', () => {
  const h = useYachtModule()

  // 하네스가 매 검사마다 새로 세운 것을 그대로 받는다. 이름을 바꾸지 않는 이유는
  // 검사 본문이 무엇을 다루는지가 이름에 남아야 하기 때문이다.
  let rounds: RoundSynchronizationService
  let timers: FakeRoundTimer
  let module: YachtDiceGameModule
  let playerA: FakeSocket
  let playerB: FakeSocket
  beforeEach(() => {
    ;({ rounds, timers, module, playerA, playerB } = h)
  })
  const { seat, envelope, rollEnvelope, holdEnvelope, errorOf } = h

  /* ------------------------------------------------------------- dice.roll */

  it('서버가 만든 주사위를 방 전원에게 같은 프레임으로 방송한다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a', 'player-b'])
    seat(playerA, 'player-a')
    seat(playerB, 'player-b')

    await module.handle(playerA, rollEnvelope(1, 'roll-one'))

    expect(playerA.frames).toHaveLength(1)
    expect(playerB.frames).toHaveLength(1)
    // 팬아웃은 한 번만 직렬화한다 — 두 소켓이 글자 단위로 같은 프레임을 받는다.
    expect(playerA.frames[0]).toBe(playerB.frames[0])
    const frame = playerA.frames[0] ?? ''
    expect(frame).toContain('"type":"game.yacht_dice.dice.broadcast"')
    expect(frame).toContain('"playerId":"player-a"')
    expect(frame).toContain('"roundNumber":1')
    expect(frame).toContain('"rollCount":1')
    expect(frame).toContain('"dice":[')
    expect(frame).toContain('"held":[false,false,false,false,false]')
    // 플레이어가 직접 굴린 결과다 — 마감 자동 굴림과 구분된다.
    expect(frame).toContain('"auto":false')
    expect(frame).toContain('"msgId":"roll-one"')
  })

  it('받아들인 굴림마다 현재 플레이어의 타이머를 다시 건다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a', 'player-b'])
    seat(playerA, 'player-a')

    await module.handle(playerA, rollEnvelope(1, 'roll-one'))
    await module.handle(playerA, rollEnvelope(2, 'roll-two'))

    expect(timers.started).toHaveLength(2)
    expect(timers.started.every((call) => call.roomId === ROOM)).toBe(true)
    expect(timers.started.every((call) => call.state.activePlayerId === 'player-a')).toBe(true)
    expect((await rounds.findByRoomId(ROOM))?.activeRollCount).toBe(2)
  })

  it('턴 주인이 아닌 굴림은 NOT_YOUR_TURN이고 상태를 전혀 건드리지 못한다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a', 'player-b'])
    seat(playerB, 'player-b')

    await module.handle(playerB, rollEnvelope(1, 'out-of-turn-roll'))

    expect(errorOf(playerB)).toMatchObject({
      code: 'NOT_YOUR_TURN',
      refMsgId: 'out-of-turn-roll',
    })
    expect(playerB.last().type).toBe('error')
    const state = await rounds.findByRoomId(ROOM)
    expect(state?.activeRollCount).toBe(0)
    expect(state?.activeDice).toBeNull()
    expect(timers.started).toHaveLength(0)
  })

  it('첫 굴림 전 held를 보내면 INVALID_MESSAGE다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a'])
    seat(playerA, 'player-a')

    await module.handle(playerA, rollEnvelope(1, 'early-held', [true, false, false, false, false]))

    expect(errorOf(playerA)).toMatchObject({ code: 'INVALID_MESSAGE', refMsgId: 'early-held' })
  })

  it('rollCount가 연속하지 않으면 INVALID_MESSAGE다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a'])
    seat(playerA, 'player-a')

    await module.handle(playerA, rollEnvelope(2, 'skipped-roll'))

    expect(errorOf(playerA)).toMatchObject({ code: 'INVALID_MESSAGE', refMsgId: 'skipped-roll' })
    expect((await rounds.findByRoomId(ROOM))?.activeRollCount).toBe(0)
  })

  it('라운드 상태가 없으면 ROUND_NOT_INITIALIZED → INTERNAL이다', async () => {
    seat(playerA, 'player-a')

    await module.handle(playerA, rollEnvelope(1, 'no-round'))

    expect(errorOf(playerA)).toMatchObject({ code: 'INTERNAL', refMsgId: 'no-round' })
  })

  /* ------------------------------------------------------------- dice.hold */

  it('굴림 사이의 KEEP 변경을 방 전원에게 알리고 타이머는 다시 걸지 않는다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a', 'player-b'])
    seat(playerA, 'player-a')
    seat(playerB, 'player-b')
    await module.handle(playerA, rollEnvelope(1, 'roll-one'))
    playerA.reset()
    playerB.reset()

    await module.handle(playerA, holdEnvelope([true, true, false, false, false], 'hold-one'))

    const frame = playerB.frames[0] ?? ''
    expect(frame).toContain('"type":"game.yacht_dice.dice.hold_changed"')
    expect(frame).toContain('"playerId":"player-a"')
    expect(frame).toContain('"held":[true,true,false,false,false]')
    expect(frame).toContain('"msgId":"hold-one"')
    // KEEP 변경은 마감 타이머를 다시 걸지 않는다 — 토글로 턴을 무한히 늘릴 수 없어야 한다.
    expect(timers.started).toHaveLength(1)
    expect((await rounds.findByRoomId(ROOM))?.activeHeld).toEqual([true, true, false, false, false])
  })

  it('턴 주인이 아닌 KEEP 변경은 NOT_YOUR_TURN이다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a', 'player-b'])
    seat(playerA, 'player-a')
    seat(playerB, 'player-b')
    await module.handle(playerA, rollEnvelope(1, 'roll-one'))
    playerB.reset()

    await module.handle(playerB, holdEnvelope([true, false, false, false, false], 'steal-hold'))

    expect(errorOf(playerB)).toMatchObject({ code: 'NOT_YOUR_TURN', refMsgId: 'steal-hold' })
    expect((await rounds.findByRoomId(ROOM))?.activeHeld).toEqual(NO_HELD)
  })

  it('첫 굴림 전 KEEP 변경은 INVALID_MESSAGE다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a'])
    seat(playerA, 'player-a')

    await module.handle(playerA, holdEnvelope([true, false, false, false, false], 'early-hold'))

    expect(errorOf(playerA)).toMatchObject({ code: 'INVALID_MESSAGE', refMsgId: 'early-hold' })
  })

  /* ------------------------------------------- dice.shake / dice.throw 비대칭 */

  it('shake는 턴 주인의 펄스를 그대로 릴레이한다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a', 'player-b'])
    seat(playerA, 'player-a')
    seat(playerB, 'player-b')

    await module.handle(
      playerA,
      envelope('dice.shake', { roundNumber: 1, direction: 'left', strength: 0.75 }, 'shake-a'),
    )

    const frame = playerB.frames[0] ?? ''
    expect(frame).toContain('"type":"game.yacht_dice.dice.shaken"')
    expect(frame).toContain('"direction":"left"')
    expect(frame).toContain('"strength":0.75')
    expect(frame).toContain('"msgId":"shake-a"')
  })

  it('턴 주인이 아닌 shake는 조용히 버린다 — 오류를 돌려주지 않는다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a', 'player-b'])
    seat(playerA, 'player-a')
    seat(playerB, 'player-b')

    await module.handle(
      playerB,
      envelope('dice.shake', { roundNumber: 1, direction: 'right', strength: 1 }, 'shake-b'),
    )

    // 고빈도 메시지라 턴 교대 순간의 잔여 펄스에 오류를 쏟지 않는 것이 계약이다.
    expect(playerB.frames).toHaveLength(0)
    expect(playerA.frames).toHaveLength(0)
  })

  it('라운드가 시작되지 않았으면 shake도 무음이다', async () => {
    seat(playerA, 'player-a')

    await module.handle(
      playerA,
      envelope('dice.shake', { roundNumber: 1, direction: 'left', strength: 1 }, 'shake-early'),
    )

    expect(playerA.frames).toHaveLength(0)
  })

  it('payload 검증이 활성 판정보다 먼저다 — 남의 턴의 깨진 shake는 INVALID_MESSAGE', async () => {
    await rounds.initialize(ROOM, 1, ['player-a', 'player-b'])
    seat(playerB, 'player-b')

    await module.handle(
      playerB,
      envelope('dice.shake', { roundNumber: 1, direction: 'left', strength: 'hard' }, 'bad-shake'),
    )

    expect(errorOf(playerB)).toMatchObject({ code: 'INVALID_MESSAGE', refMsgId: 'bad-shake' })
  })

  it('throw는 턴 주인의 신호만 릴레이하고 남의 것은 NOT_YOUR_TURN이다', async () => {
    await rounds.initialize(ROOM, 1, ['player-a', 'player-b'])
    seat(playerA, 'player-a')
    seat(playerB, 'player-b')

    await module.handle(
      playerA,
      envelope('dice.throw', { roundNumber: 1, rollCount: 1 }, 'throw-a'),
    )
    const relayed = playerB.frames[0] ?? ''
    expect(relayed).toContain('"type":"game.yacht_dice.dice.thrown"')
    expect(relayed).toContain('"rollCount":1')
    playerB.reset()

    await module.handle(
      playerB,
      envelope('dice.throw', { roundNumber: 1, rollCount: 1 }, 'throw-b'),
    )

    // 남의 사발을 대신 엎는 신호이므로 shake와 달리 오류를 돌려준다.
    expect(errorOf(playerB)).toMatchObject({ code: 'NOT_YOUR_TURN', refMsgId: 'throw-b' })
  })
})
