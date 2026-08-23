import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryRoundDeadlineStore } from '../deadlineStore.js'
import type { ConfirmedScore } from '../roundPorts.js'
import { RoundState, type RoundSubmissionResult } from '../roundState.js'
import { InMemoryRoundStateStore } from '../roundStateStore.js'
import { RoundSubmission } from '../roundSubmission.js'
import { RoundSynchronizationService } from '../roundSynchronizationService.js'
import {
  advancedResolution,
  autoRolledResolution,
  type RoundTimeoutResolution,
  type RoundTimeoutResolverPort,
  staleResolution,
} from '../roundTimeoutResolver.js'
import {
  EXPIRY_GRACE_MS,
  ROUND_DURATION_MS,
  type RoundStartedEvent,
  RoundTimerService,
} from '../roundTimerService.js'
import {
  FakeGameCompletion,
  FakePresence,
  FakeRoomService,
  FakeRoundDeadlineScheduler,
  RecordingBroadcaster,
} from './testDoubles.js'

/**
 * backend-java `RoundTimerServiceTest`의 이식 + Java에 없던 오프라인·이탈 경로.
 *
 * **방송 순서가 계약이다.** Mockito `InOrder` 대신 기록형 브로드캐스터의 배열
 * 순서로 고정한다. 시간은 고정 `now`, 마감 발화는 가짜 예약기의 `fire()`라
 * 실시간 sleep이 없다.
 */
describe('RoundTimerService', () => {
  const NOW = Date.parse('2026-07-26T00:00:00Z')
  const DEADLINE = NOW + ROUND_DURATION_MS
  const SOLO = ['player-a']
  const DUO = ['player-a', 'player-b']
  /** 시계가 도는 방 = 사람이 둘 이상인 방(`UNTIMED_HUMAN_LIMIT`). */
  const humanRoster = (playerIds: readonly string[]) =>
    playerIds.map((playerId) => ({ playerId, kind: 'HUMAN' }))

  let scheduler: FakeRoundDeadlineScheduler
  let broadcaster: RecordingBroadcaster
  let timeoutResolver: StubTimeoutResolver
  let gameCompletion: FakeGameCompletion
  let presence: FakePresence
  let roomService: FakeRoomService
  let store: InMemoryRoundStateStore
  let deadlineStore: InMemoryRoundDeadlineStore
  let synchronizationService: RoundSynchronizationService
  let roundStarted: RoundStartedEvent[]
  let warnings: string[]
  let timerService: RoundTimerService

  beforeEach(() => {
    scheduler = new FakeRoundDeadlineScheduler()
    broadcaster = new RecordingBroadcaster()
    timeoutResolver = new StubTimeoutResolver()
    gameCompletion = new FakeGameCompletion()
    roomService = new FakeRoomService({ gameId: 'game-a', players: humanRoster(DUO) })
    store = new InMemoryRoundStateStore()
    deadlineStore = new InMemoryRoundDeadlineStore()
    synchronizationService = new RoundSynchronizationService(store, { dieRoller: () => 1 })
    // 참가자를 명단에 올려 online으로 만든다. 비어 있으면 start()가 전원을 오프라인으로
    // 보고 타이머를 걸지 않아, 이 클래스의 검증 대상 자체가 실행되지 않는다.
    presence = new FakePresence().online('room-a', ...DUO)
    roundStarted = []
    warnings = []
    timerService = new RoundTimerService(
      {
        timeoutResolver,
        deadlineScheduler: scheduler,
        deadlineStore,
        broadcaster,
        gameCompletion,
        synchronizationService,
        presence,
        roomService,
      },
      {
        now: () => NOW,
        onRoundStarted: (event) => roundStarted.push(event),
        onWarning: (_roomId, reason) => warnings.push(reason),
      },
    )
  })

  /**
   * 방 TTL은 sliding이어야 한다. 턴마다 갱신하지 않으면 "생성 후 40분"에 방이 사라져,
   * 한 판이 그보다 길어지는 순간 플레이 중인 방이 없어진다.
   */
  it('턴이 시작될 때마다 방 수명을 늘린다', async () => {
    await timerService.start('room-a', RoundState.start(1, DUO))
    await timerService.start('room-a', RoundState.start(2, DUO))

    expect(roomService.touchCount).toBe(2)
  })

  it('서버 마감 시각과 턴 순서를 실어 round.start를 방송한다', async () => {
    const deadline = await timerService.start('room-a', RoundState.start(1, DUO))

    expect(deadline).toBe(DEADLINE)
    expect(timerService.currentDeadline('room-a')).toBe(DEADLINE)
    // 마감 직전에 떠난 round.submit이 도착할 틈을 주고 나서 강제 진행한다.
    expect(scheduler.deadline).toBe(DEADLINE + EXPIRY_GRACE_MS)
    const message = onlyBroadcast()
    expect(message.type).toBe('game.yacht_dice.round.start')
    expect(message.ts).toBe(NOW)
    expect(message.roomId).toBe('room-a')
    expect(message.msgId).toBeUndefined()
    // 턴 순서를 함께 실어야 클라가 명단 정렬로 순서를 추측하지 않는다.
    expect(message.payload).toEqual({
      roundNumber: 1,
      deadline: DEADLINE,
      activePlayerId: 'player-a',
      turnOrder: DUO,
    })
    // 봇 오케스트레이터(3.2)가 이 이벤트로 자기 차례를 안다.
    expect(roundStarted).toHaveLength(1)
    expect(roundStarted[0]?.state.activePlayerId).toBe('player-a')
  })

  /**
   * 연습 방(사람 하나 + 봇) — 기다리는 사람이 없으므로 시계를 걸지 않는다.
   * `deadline: null`이 그대로 방송되고, 강제 진행 예약도 만들지 않는다.
   */
  it('사람이 혼자인 방에는 마감을 걸지 않는다', async () => {
    roomService.snapshot = {
      gameId: 'game-a',
      players: [
        { playerId: 'player-a', kind: 'HUMAN' },
        { playerId: 'bot-1', kind: 'BOT' },
      ],
    }

    const deadline = await timerService.start('room-a', RoundState.start(1, ['player-a', 'bot-1']))

    expect(deadline).toBeNull()
    // undefined(진행 중인 턴 없음)와 구별돼야 한다 — 재접속이 그 둘을 다르게 다룬다.
    expect(timerService.currentDeadline('room-a')).toBeNull()
    expect(scheduler.timeoutAction).toBeNull()
    expect(onlyBroadcast().payload).toEqual({
      roundNumber: 1,
      deadline: null,
      activePlayerId: 'player-a',
      turnOrder: ['player-a', 'bot-1'],
    })
  })

  /**
   * 연습 방이라도 **봇 턴에는 폴백 예약이 남는다** — 봇 스텝의 예외를 받아 줄 것이
   * 라운드 타이머뿐이라, 없으면 굴림 한 번 실패한 판이 영원히 멈춘다.
   * 화면에는 여전히 시계가 없다(`deadline: null`).
   */
  it('연습 방의 봇 턴은 화면에 시계 없이 폴백만 예약한다', async () => {
    roomService.snapshot = {
      gameId: 'game-a',
      players: [
        { playerId: 'player-a', kind: 'HUMAN' },
        { playerId: 'bot-1', kind: 'BOT' },
      ],
    }

    const deadline = await timerService.start('room-a', RoundState.start(1, ['bot-1', 'player-a']))

    expect(deadline).toBeNull()
    expect(onlyBroadcast().payload).toMatchObject({ deadline: null, activePlayerId: 'bot-1' })
    expect(scheduler.deadline).toBe(DEADLINE + EXPIRY_GRACE_MS)
    expect(scheduler.timeoutAction).not.toBeNull()
  })

  /** 시계가 없어도 판은 굴러간다 — 다음 턴은 제출·이탈이 밀어 준다. */
  it('연습 방에서도 제출하면 다음 턴이 시작된다', async () => {
    roomService.snapshot = {
      gameId: 'game-a',
      players: [
        { playerId: 'player-a', kind: 'HUMAN' },
        { playerId: 'bot-1', kind: 'BOT' },
      ],
    }
    const roster = ['player-a', 'bot-1']
    await synchronizationService.initialize('room-a', 1, roster)
    const advanced = await synchronizationService.expire('room-a', 1, 'player-a')
    broadcaster.reset()

    await timerService.advanceTurn('room-a', {
      score: null,
      round: advanced as RoundSubmissionResult,
    })

    const started = broadcaster.messagesFor('room-a').at(-1)
    expect(started?.type).toBe('game.yacht_dice.round.start')
    expect(started?.payload).toMatchObject({ deadline: null, activePlayerId: 'bot-1' })
  })

  /** 방 스냅샷을 못 읽었으면 판단하지 않는다 — 기존 동작(시계 있음)으로 떨어진다. */
  it('방 스냅샷이 없으면 시계를 건다', async () => {
    roomService.snapshot = null

    const deadline = await timerService.start('room-a', RoundState.start(1, DUO))

    expect(deadline).toBe(DEADLINE)
  })

  it('서버 대리 굴림 뒤에는 같은 턴에 시간을 다시 준다', async () => {
    const rolled = RoundState.start(1, DUO).recordRoll('player-a', 1, 1, noHeld(), STRAIGHT)
    timeoutResolver.resolution = autoRolledResolution(rolled)
    await timerService.start('room-a', RoundState.start(1, DUO))
    broadcaster.reset()

    await scheduler.fire()

    // 턴 주인은 그대로다 — 남은 굴림을 직접 쓸 시간을 다시 준다.
    expect(onlyBroadcast().payload).toEqual({
      roundNumber: 1,
      deadline: DEADLINE,
      activePlayerId: 'player-a',
      turnOrder: DUO,
    })
    expect(scheduler.timeoutAction).not.toBeNull()
  })

  it('마감 처리가 점수를 기록했으면 다음 플레이어의 턴을 시작한다', async () => {
    const nextTurn = rolled(RoundState.start(1, DUO)).submit(submission('player-a', 1)).state
    timeoutResolver.resolution = advancedResolution({ state: nextTurn, completedRound: null })
    await timerService.start('room-a', RoundState.start(1, DUO))
    broadcaster.reset()

    await scheduler.fire()

    expect(onlyBroadcast().payload).toEqual({
      roundNumber: 1,
      deadline: DEADLINE,
      activePlayerId: 'player-b',
      turnOrder: DUO,
    })
  })

  it('스테일 마감은 아무것도 방송하지 않는다', async () => {
    timeoutResolver.resolution = staleResolution()
    await timerService.start('room-a', RoundState.start(1, DUO))
    broadcaster.reset()

    await scheduler.fire()

    expect(broadcaster.sent).toEqual([])
  })

  it('다음 라운드가 시작되기 전에 round.end를 알린다', async () => {
    const completed = rolled(RoundState.start(1, SOLO)).submit(submission('player-a', 1))
    timeoutResolver.resolution = advancedResolution(completed)
    await timerService.start('room-a', RoundState.start(1, SOLO))
    broadcaster.reset()

    await scheduler.fire()

    expect(broadcaster.typesFor('room-a')).toEqual([
      'game.yacht_dice.round.end',
      'game.yacht_dice.round.start',
    ])
    expect(broadcaster.messagesFor('room-a')[0]?.payload).toEqual({
      roundNumber: 1,
      submitted: SOLO,
    })
  })

  /** 마감 처리로 들어온 점수는 resolver가 이미 방송했다. 여기서 또 쏘면 클라가 중복 반영한다. */
  it('마감 경로가 기록한 점수를 다시 방송하지 않는다', async () => {
    const completed = rolled(RoundState.start(1, SOLO)).submit(submission('player-a', 1))
    timeoutResolver.resolution = advancedResolution(completed)
    await timerService.start('room-a', RoundState.start(1, SOLO))
    broadcaster.reset()

    await scheduler.fire()

    expect(broadcaster.typesFor('room-a')).not.toContain('game.yacht_dice.score.update')
  })

  it('플레이어 제출은 score.update → round.end → round.start 순으로 방송한다', async () => {
    const completed = rolled(RoundState.start(1, SOLO)).submit(submission('player-a', 1))

    await timerService.advanceTurn(
      'room-a',
      { score: score('player-a'), round: completed },
      'msg-1',
    )

    const messages = broadcaster.messagesFor('room-a')
    expect(messages.map((message) => message.type)).toEqual([
      'game.yacht_dice.score.update',
      'game.yacht_dice.round.end',
      'game.yacht_dice.round.start',
    ])
    // 클라는 msgId로 자기 제출의 확정을 판별한다.
    expect(messages[0]?.msgId).toBe('msg-1')
    expect(messages[1]?.msgId).toBeUndefined()
  })

  /**
   * 마지막 라운드가 끝나면 다음 턴 타이머를 걸지 않는다. 이걸 걸면 종료된 게임이
   * 계속 돌아간다(라운드가 무한히 증가하던 원인).
   */
  it('게임이 끝났으면 다음 턴을 시작하지 않는다', async () => {
    const secondRound = rolled(RoundState.start(1, SOLO, 2)).submit(submission('player-a', 1)).state
    const lastRound = rolled(secondRound).submit(submission('player-a', 2))
    expect(lastRound.completedRound?.gameCompleted).toBe(true)
    gameCompletion.result = true

    await timerService.advanceTurn('room-a', { score: null, round: lastRound })

    expect(broadcaster.typesFor('room-a')).toEqual(['game.yacht_dice.round.end'])
    expect(gameCompletion.calls).toEqual([{ roomId: 'room-a', force: true }])
    expect(scheduler.timeoutAction).toBeNull()
    expect(timerService.currentDeadline('room-a')).toBeUndefined()
  })

  /** 종료 전이가 실패해도 다음 턴을 걸지 않는다 — 걸면 상한을 넘긴 라운드가 계속 진행된다. */
  it('라운드 상한에 닿으면 종료 전이가 실패해도 멈춘다', async () => {
    const lastRound = rolled(RoundState.start(1, SOLO, 1)).submit(submission('player-a', 1))
    gameCompletion.result = false

    await timerService.advanceTurn('room-a', { score: null, round: lastRound })

    expect(broadcaster.typesFor('room-a')).toEqual(['game.yacht_dice.round.end'])
    expect(scheduler.timeoutAction).toBeNull()
    expect(warnings).toEqual(['round_cap_reached_without_finish'])
  })

  /* ------------------------------------------ Java에 없던 계약: 오프라인·게임 중 이탈 */

  it('오프라인 플레이어의 첫 턴은 타이머 없이 무득점 스킵한다', async () => {
    await synchronizationService.initialize('room-a', 1, DUO)
    presence.offline('room-a', 'player-a')

    const deadline = await timerService.start('room-a', await currentState())

    expect(deadline).toBeNull()
    // 스킵된 턴은 방 TTL을 밀지 않는다 — touch는 뒤이어 시작된 player-b의 턴 한 번뿐이다.
    expect(roomService.touchCount).toBe(1)
    expect(broadcaster.typesFor('room-a')).toEqual(['game.yacht_dice.round.start'])
    expect((onlyBroadcast().payload as { activePlayerId: string }).activePlayerId).toBe('player-b')
    expect((await currentState()).activePlayerId).toBe('player-b')
  })

  it('오프라인으로 두 번째 자기 턴을 맞으면 자동 퇴장시킨다', async () => {
    await synchronizationService.initialize('room-a', 1, DUO)
    presence.offline('room-a', 'player-a')
    // 1턴째: 스킵되어 player-b의 턴이 된다.
    await timerService.start('room-a', await currentState())
    // player-b의 턴도 만료 → 라운드 1이 끝나고 2라운드가 다시 player-a부터 시작한다.
    const expired = await synchronizationService.expire('room-a', 1, 'player-b')
    broadcaster.reset()

    await timerService.advanceTurn('room-a', {
      score: null,
      round: expired as RoundSubmissionResult,
    })

    expect(broadcaster.typesFor('room-a')).toEqual([
      'game.yacht_dice.round.end',
      'room.player_left',
      'game.yacht_dice.round.start',
    ])
    expect(broadcaster.messagesFor('room-a')[1]?.payload).toEqual({ playerId: 'player-a' })
    // 명단(레지스트리·Redis)과 턴 순서에서 모두 빠진다.
    expect(presence.find('room-a', 'player-a')).toBeNull()
    expect(roomService.left).toEqual([{ roomId: 'room-a', playerId: 'player-a' }])
    expect((await currentState()).participantOrder).toEqual(['player-b'])
  })

  it('재접속하면 오프라인 결석 횟수를 처음부터 다시 센다', async () => {
    await synchronizationService.initialize('room-a', 1, DUO)
    presence.offline('room-a', 'player-a')
    await timerService.start('room-a', await currentState())

    // 복귀했다가 다시 끊긴 사람은 첫 결석부터 다시 시작해야 한다(2턴 = 자동 퇴장).
    timerService.clearOfflineMisses('room-a', 'player-a')
    presence.online('room-a', 'player-a')
    presence.offline('room-a', 'player-a')
    broadcaster.reset()
    const secondRound = await synchronizationService.expire('room-a', 1, 'player-b')
    await timerService.advanceTurn('room-a', {
      score: null,
      round: secondRound as RoundSubmissionResult,
    })

    expect(broadcaster.typesFor('room-a')).not.toContain('room.player_left')
    expect((await currentState()).participantIds.has('player-a')).toBe(true)
  })

  /** 봇은 소켓이 없다 — 명단으로 판정하면 매 턴 스킵되어 봇이 한 번도 플레이하지 못한다. */
  it('봇은 오프라인으로 보지 않는다', async () => {
    // 사람 둘 + 봇 하나 — 사람이 혼자면 시계 자체가 안 걸리므로(아래 「연습 방」 절)
    // 봇 판정만 보려면 시계가 도는 방이어야 한다.
    roomService.snapshot = {
      gameId: 'game-a',
      players: [{ playerId: 'bot-1', kind: 'BOT' }, ...humanRoster(DUO)],
    }

    const deadline = await timerService.start('room-a', RoundState.start(1, ['bot-1', 'player-b']))

    expect(deadline).toBe(DEADLINE)
    expect(onlyBroadcast().type).toBe('game.yacht_dice.round.start')
  })

  it('활성 플레이어가 나가면 만료로 넘기고 다음 턴을 시작한다', async () => {
    await synchronizationService.initialize('room-a', 1, DUO)
    broadcaster.reset()

    await timerService.removePlayer('room-a', 'player-a')

    expect(broadcaster.typesFor('room-a')).toEqual([
      'room.player_left',
      'game.yacht_dice.round.start',
    ])
    const state = await currentState()
    expect(state.participantOrder).toEqual(['player-b'])
    expect(state.activePlayerId).toBe('player-b')
  })

  it('이미 빠진 플레이어에게는 room.player_left를 다시 쏘지 않는다', async () => {
    await synchronizationService.initialize('room-a', 1, DUO)
    await timerService.removePlayer('room-a', 'player-a')
    broadcaster.reset()

    await timerService.removePlayer('room-a', 'player-a')

    expect(broadcaster.typesFor('room-a')).toEqual([])
  })

  it('마지막 참가자가 나가면 라운드 상태와 타이머를 통째로 버린다', async () => {
    await synchronizationService.initialize('room-a', 1, SOLO)
    await timerService.start('room-a', await currentState())
    broadcaster.reset()

    await timerService.removePlayer('room-a', 'player-a')

    expect(scheduler.cancelledRooms).toEqual(['room-a'])
    expect(timerService.currentDeadline('room-a')).toBeUndefined()
    expect(await store.findByRoomId('room-a')).toBeUndefined()
    expect(broadcaster.typesFor('room-a')).toEqual(['room.player_left'])
  })

  const currentState = async (): Promise<RoundState> => {
    const state = await store.findByRoomId('room-a')
    if (state === undefined) throw new Error('라운드 상태가 없다')
    return state
  }

  const onlyBroadcast = () => {
    const messages = broadcaster.messagesFor('room-a')
    expect(messages).toHaveLength(1)
    return messages[0] as {
      type: string
      ts: number
      payload: unknown
      roomId?: string
      msgId?: string
    }
  }

  /* ------------------------------------------------------- 부팅 재무장 (PR 6) */

  /**
   * 마감 시각 영속화의 핵심 계약(deploy/PLAN.md PR 6).
   *
   * 판정 기준은 "저장하는가"가 아니라 **"인메모리 Map을 잃은 새 인스턴스가 원래 마감을
   * 그대로 이어가는가"** 다. 그래서 아래 테스트들은 저장소만 물려받은 두 번째
   * `RoundTimerService`를 만들어 검증한다 — 그 저장소 자리가 운영에서는 Redis다.
   */
  describe('resumeFromStored', () => {
    const restarted = (now: number): RoundTimerService =>
      new RoundTimerService(
        {
          timeoutResolver,
          deadlineScheduler: scheduler,
          deadlineStore,
          broadcaster,
          gameCompletion,
          synchronizationService,
          presence,
          roomService,
        },
        { now: () => now, onRoundStarted: (event) => roundStarted.push(event) },
      )

    it('start가 마감을 저장한다', async () => {
      await timerService.start('room-a', RoundState.start(1, DUO))

      await expect(deadlineStore.find('room-a')).resolves.toEqual({
        roundNumber: 1,
        deadline: DEADLINE,
      })
    })

    it('시계 없는 연습 방은 마감을 null로 저장한다', async () => {
      roomService.snapshot = { gameId: 'game-a', players: humanRoster(SOLO) }

      await timerService.start('room-a', RoundState.start(1, SOLO))

      await expect(deadlineStore.find('room-a')).resolves.toEqual({
        roundNumber: 1,
        deadline: null,
      })
    })

    /** 미래 분기 — 재시작 뒤에도 **같은** 마감으로 이어간다(새 25초가 아니다). */
    it('마감이 아직 남았으면 그 시각으로 재무장한다', async () => {
      const state = RoundState.start(1, DUO)
      await timerService.start('room-a', state)
      broadcaster.reset()
      // 10초 뒤에 프로세스가 되살아났다.
      const timer = restarted(NOW + 10_000)

      await expect(timer.resumeFromStored('room-a', state)).resolves.toBe(true)

      expect(timer.currentDeadline('room-a')).toBe(DEADLINE)
      expect(scheduler.deadline).toBe(DEADLINE + EXPIRY_GRACE_MS)
      const message = onlyBroadcast()
      expect(message.type).toBe('game.yacht_dice.round.start')
      // 클라가 보는 마감도 원래 값이어야 한다 — 새 값을 주면 남은 시간이 늘어난다.
      expect((message.payload as { deadline: number }).deadline).toBe(DEADLINE)
    })

    /**
     * 이미 지남 분기. 별도 분기 코드가 없는 것이 요점이다 — 예약기가 지연을 0으로
     * 깎아 그 자리에서 발화하므로 턴이 서버 대리로 넘어간다.
     */
    it('마감이 이미 지났으면 과거 시각으로 예약해 즉시 발화시킨다', async () => {
      const state = RoundState.start(1, DUO)
      await timerService.start('room-a', state)
      const restartedAt = DEADLINE + 60_000
      const timer = restarted(restartedAt)

      await expect(timer.resumeFromStored('room-a', state)).resolves.toBe(true)

      expect(scheduler.deadline).toBe(DEADLINE + EXPIRY_GRACE_MS)
      expect(scheduler.deadline).toBeLessThan(restartedAt)
    })

    it('시계 없는 턴은 시계 없이 이어간다', async () => {
      roomService.snapshot = { gameId: 'game-a', players: humanRoster(SOLO) }
      const state = RoundState.start(1, SOLO)
      await timerService.start('room-a', state)
      // 연습 방의 사람 턴은 애초에 예약하지 않는다 — 그 상태가 그대로 유지돼야 한다.
      expect(scheduler.deadline).toBeNull()
      broadcaster.reset()
      const timer = restarted(NOW + 10_000)

      await expect(timer.resumeFromStored('room-a', state)).resolves.toBe(true)

      expect(timer.currentDeadline('room-a')).toBeNull()
      expect(scheduler.deadline).toBeNull()
      expect((onlyBroadcast().payload as { deadline: number | null }).deadline).toBeNull()
    })

    /** 유효하지 않음 분기 — 호출자가 그 방을 fail-closed로 닫는다. */
    it('기록이 없으면 false를 낸다', async () => {
      await expect(
        restarted(NOW).resumeFromStored('room-a', RoundState.start(1, DUO)),
      ).resolves.toBe(false)
    })

    /**
     * 라운드 번호 대조가 있어야 하는 이유: 게임 종료 경로 일부는 예약기만 취소하므로
     * 기록이 TTL까지 남을 수 있다. 대조가 없으면 그 낡은 기록으로 **이미 끝난 턴을**
     * 되살린다.
     */
    it('라운드 번호가 어긋난 기록으로는 되살리지 않는다', async () => {
      await deadlineStore.save('room-a', { roundNumber: 1, deadline: DEADLINE })

      await expect(
        restarted(NOW).resumeFromStored('room-a', RoundState.start(2, DUO)),
      ).resolves.toBe(false)
    })

    it('cancel은 그 라운드의 기록만 지운다', async () => {
      await deadlineStore.save('room-a', { roundNumber: 2, deadline: DEADLINE })

      await timerService.cancel('room-a', 1)
      await expect(deadlineStore.find('room-a')).resolves.not.toBeUndefined()

      await timerService.cancel('room-a', 2)
      await expect(deadlineStore.find('room-a')).resolves.toBeUndefined()
    })

    /**
     * 부팅 시점에는 아직 아무 소켓도 붙지 않았다. 오프라인 판정을 그대로 태우면
     * 재무장이 곧 턴 스킵이 되고, 두 턴이면 `MAX_OFFLINE_TURNS`에 걸려 **재시작만으로
     * 사람이 방에서 쫓겨난다.**
     */
    it('되살릴 때는 접속이 없어도 턴을 스킵하지 않는다', async () => {
      const state = RoundState.start(1, DUO)
      await timerService.start('room-a', state)
      broadcaster.reset()
      // 새 프로세스의 레지스트리는 비어 있다 = 전원 오프라인으로 답한다.
      presence = new FakePresence()
      const timer = new RoundTimerService(
        {
          timeoutResolver,
          deadlineScheduler: scheduler,
          deadlineStore,
          broadcaster,
          gameCompletion,
          synchronizationService,
          presence,
          roomService,
        },
        { now: () => NOW + 5_000 },
      )

      await expect(timer.resumeFromStored('room-a', state)).resolves.toBe(true)

      expect(timer.currentDeadline('room-a')).toBe(DEADLINE)
      expect(onlyBroadcast().type).toBe('game.yacht_dice.round.start')
    })

    it('cancelRoom은 기록을 통째로 지운다', async () => {
      await timerService.start('room-a', RoundState.start(1, DUO))

      await timerService.cancelRoom('room-a')

      await expect(deadlineStore.find('room-a')).resolves.toBeUndefined()
    })
  })
})

const STRAIGHT = [1, 2, 3, 4, 5]

const noHeld = (): boolean[] => [false, false, false, false, false]

const submission = (playerId: string, roundNumber: number): RoundSubmission =>
  new RoundSubmission(playerId, roundNumber, STRAIGHT, 'smallStraight')

const rolled = (state: RoundState): RoundState =>
  state.recordRoll(state.activePlayerId, state.roundNumber, 1, noHeld(), STRAIGHT)

const score = (playerId: string): ConfirmedScore => ({
  playerId,
  scoreboard: { categories: { smallStraight: 15 }, subtotal: 0, bonus: 0, total: 15 },
})

/** Java 테스트의 `mock(RoundTimeoutResolver.class)` 자리. */
class StubTimeoutResolver implements RoundTimeoutResolverPort {
  resolution: RoundTimeoutResolution = staleResolution()
  readonly calls: { roomId: string; roundNumber: number; activePlayerId: string }[] = []

  async resolve(
    roomId: string,
    roundNumber: number,
    activePlayerId: string,
  ): Promise<RoundTimeoutResolution> {
    this.calls.push({ roomId, roundNumber, activePlayerId })
    return this.resolution
  }
}
