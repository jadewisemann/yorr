import { beforeEach, describe, expect, it } from 'vitest'
import { DuelGameService, type DuelStartRoster } from '../duelGameService.js'
import type {
  DuelBroadcaster,
  DuelCompletionPort,
  DuelDeadlineScheduler,
  DuelMarkablePhase,
  DuelOutboundEnvelope,
  DuelPresence,
  DuelRoomSnapshotPort,
  DuelScoreboardPort,
} from '../duelPorts.js'
import { MAX_HP } from '../duelRules.js'
import type { DuelState } from '../duelState.js'
import type { DuelStateStore } from '../duelStateStore.js'

const ROOM = 'ROOM1'
const HOST = 'player-1'
const GUEST = 'player-2'

interface FakeSnapshot {
  readonly roomId: string
  readonly phase: string
}

/** 스토어의 계약(version 비증가 무시)만 지키는 인메모리 대역. Redis 판은 별도 스위트. */
class InMemoryDuelStateStore implements DuelStateStore {
  private readonly states = new Map<string, DuelState>()

  async initialize(roomId: string, state: DuelState): Promise<void> {
    if (this.states.has(roomId)) throw new Error('duel_already_initialized')
    this.states.set(roomId, state)
  }

  async find(roomId: string): Promise<DuelState | null> {
    return this.states.get(roomId) ?? null
  }

  async mutate(
    roomId: string,
    mutation: (current: DuelState) => DuelState | null,
  ): Promise<DuelState | null> {
    const current = this.states.get(roomId)
    if (current === undefined) return null
    const next = mutation(current)
    if (next === null || next.version <= current.version) return null
    this.states.set(roomId, next)
    return next
  }

  async remove(roomId: string): Promise<boolean> {
    return this.states.delete(roomId)
  }
}

interface Scheduled {
  readonly version: number
  readonly deadline: number
  readonly action: () => void | Promise<void>
}

class FakeScheduler implements DuelDeadlineScheduler {
  readonly scheduled: Scheduled[] = []
  cancelled = 0

  schedule(
    _roomId: string,
    version: number,
    deadline: Date | number,
    timeoutAction: () => void | Promise<void>,
  ): void {
    this.scheduled.push({
      version,
      deadline: deadline instanceof Date ? deadline.getTime() : deadline,
      action: timeoutAction,
    })
  }

  cancelRoom(): unknown {
    this.cancelled += 1
    return undefined
  }

  /** 마지막 예약을 발화한다 — 서버 시계가 그 마감에 닿았다는 뜻이다. */
  async fireLatest(): Promise<void> {
    const latest = this.scheduled.at(-1)
    if (latest === undefined) throw new Error('예약된 마감이 없다')
    await latest.action()
  }
}

describe('DuelGameService', () => {
  let store: InMemoryDuelStateStore
  let scheduler: FakeScheduler
  let sent: { roomId: string; message: DuelOutboundEnvelope }[]
  let phases: DuelMarkablePhase[]
  let written: { roomId: string; scores: Map<string, number> }[]
  let completions: { roomId: string; force: boolean }[]
  let clock: number
  let service: DuelGameService<FakeSnapshot>

  const roster = (players: readonly { playerId: string; kind: string }[]): DuelStartRoster => ({
    hostId: HOST,
    players,
  })

  const humans = (): DuelStartRoster =>
    roster([
      { playerId: GUEST, kind: 'HUMAN' },
      { playerId: HOST, kind: 'HUMAN' },
    ])

  const types = (): string[] => sent.map((entry) => entry.message.type)

  const state = async (): Promise<DuelState> => {
    const current = await store.find(ROOM)
    if (current === null) throw new Error('상태가 없다')
    return current
  }

  beforeEach(() => {
    store = new InMemoryDuelStateStore()
    scheduler = new FakeScheduler()
    sent = []
    phases = []
    written = []
    completions = []
    clock = 10_000

    const broadcaster: DuelBroadcaster = {
      broadcast: (roomId, message) => sent.push({ roomId, message }),
    }
    const presence: DuelPresence = { markPhase: (_roomId, phase) => phases.push(phase) }
    const snapshots: DuelRoomSnapshotPort<FakeSnapshot> = {
      snapshot: async (roomId) => ({ roomId, phase: 'playing' }),
    }
    const scoreboard: DuelScoreboardPort = {
      writeScores: async (roomId, scores) => {
        written.push({ roomId, scores: new Map(scores) })
      },
    }
    const completion: DuelCompletionPort = {
      finishIfComplete: async (roomId, force) => {
        completions.push({ roomId, force })
        return true
      },
    }

    service = new DuelGameService<FakeSnapshot>(
      {
        states: store,
        scheduler,
        broadcaster,
        realtimeSnapshots: snapshots,
        presence,
        completion,
        scoreboard,
      },
      { now: () => clock, wait: () => 2_000 },
    )
  })

  it('시작이 phase를 playing으로 표시한다 — 없으면 끊긴 플레이어가 player_left가 된다', async () => {
    await service.start(ROOM, humans())

    expect(phases).toEqual(['playing'])
  })

  it('시작은 호스트를 playerOrder[0]에 둔다', async () => {
    await service.start(ROOM, humans())

    expect((await state()).playerOrder).toEqual([HOST, GUEST])
  })

  it('시작이 state와 state.sync를 뿌리고 첫 신호를 version 키로 예약한다', async () => {
    await service.start(ROOM, humans())

    expect(types()).toEqual(['game.duel.state', 'game.duel.state.sync'])
    expect(sent[0]?.message.payload).toEqual(await state())
    expect(sent[1]?.message.payload).toEqual({
      snapshot: { roomId: ROOM, phase: 'playing', game: await state() },
    })
    expect(scheduler.scheduled).toEqual([
      { version: 1, deadline: 12_000, action: expect.any(Function) },
    ])
  })

  it('사람이 2명이 아니면 시작을 거부한다(봇은 세지 않는다)', async () => {
    await expect(
      service.start(
        ROOM,
        roster([
          { playerId: HOST, kind: 'HUMAN' },
          { playerId: 'bot-1', kind: 'BOT' },
        ]),
      ),
    ).rejects.toThrow('duel_requires_two_players')
  })

  it('마감이 대기 → 신호로 넘긴다', async () => {
    await service.start(ROOM, humans())
    sent = []
    clock = 12_000

    await scheduler.fireLatest()

    expect((await state()).phase).toBe('SIGNAL')
    expect((await state()).signalAt).toBe(12_000)
    // SIGNAL 프레임에는 방 스냅샷을 붙이지 않는다.
    expect(types()).toEqual(['game.duel.state'])
    expect(scheduler.scheduled.at(-1)?.version).toBe(2)
  })

  it('기대 버전이 어긋난 마감은 아무 일도 하지 않는다', async () => {
    await service.start(ROOM, humans())
    const stale = scheduler.scheduled[0]
    clock = 12_000
    await scheduler.fireLatest() // WAITING → SIGNAL (version 2)
    sent = []

    await stale?.action()

    expect((await state()).version).toBe(2)
    expect(types()).toEqual([])
  })

  it('draw가 잘못된 inputSeq를 거부한다', async () => {
    await service.start(ROOM, humans())

    await expect(service.draw(ROOM, HOST, { inputSeq: -1, reactionMs: 100 })).rejects.toThrow(
      'invalid_duel_draw',
    )
  })

  it('종료 시 점수는 잔탄이고 쓰러진 쪽은 0이다 — 파울 패자가 총알을 들고 1위가 되지 않게', async () => {
    await service.start(ROOM, humans())

    // 1회차 부정출발 → WARNING → 다음 라운드 → 2회차 부정출발 → SELF_SHOT(hp 2 잔존)
    await service.draw(ROOM, HOST, { inputSeq: 1, reactionMs: -1 })
    expect((await state()).lastRound?.kind).toBe('WARNING')
    await scheduler.fireLatest() // RESULT → 다음 라운드 WAITING
    await service.draw(ROOM, HOST, { inputSeq: 2, reactionMs: -1 })
    expect((await state()).lastRound?.kind).toBe('SELF_SHOT')
    expect((await state()).hp[HOST]).toBe(MAX_HP - 1)

    sent = []
    await scheduler.fireLatest() // KO 연출 종료 → FINISHED

    expect((await state()).phase).toBe('FINISHED')
    expect(written).toEqual([
      {
        roomId: ROOM,
        scores: new Map([
          [HOST, 0],
          [GUEST, MAX_HP],
        ]),
      },
    ])
    expect(completions).toEqual([{ roomId: ROOM, force: true }])
    expect(types()).toEqual(['game.duel.state', 'game.duel.state.sync'])
  })

  it('이탈은 forfeit으로 즉시 종료하고 생존자만 점수를 남긴다', async () => {
    await service.start(ROOM, humans())
    scheduler.cancelled = 0

    await service.removePlayer(ROOM, HOST)

    const finished = await state()
    expect(finished.phase).toBe('FINISHED')
    expect(finished.lastRound?.kind).toBe('FORFEIT')
    expect(finished.lastRound?.shooterId).toBe(GUEST)
    expect(written).toEqual([
      {
        roomId: ROOM,
        scores: new Map([
          [HOST, 0],
          [GUEST, MAX_HP],
        ]),
      },
    ])
    expect(scheduler.cancelled).toBe(1)
  })

  it('종료된 결투에 이탈이 한 번 더 와도 다시 종료 처리하지 않는다', async () => {
    await service.start(ROOM, humans())
    await service.removePlayer(ROOM, HOST)
    written = []
    completions = []

    await service.removePlayer(ROOM, GUEST)

    expect(written).toEqual([])
    expect(completions).toEqual([])
  })

  it('재접속 스냅샷에 결투 상태가 실린다', async () => {
    await service.start(ROOM, humans())

    expect(await service.reconnect(ROOM)).toEqual({
      roomId: ROOM,
      phase: 'playing',
      game: await state(),
    })
  })

  it('상태가 없으면 재접속은 방 스냅샷 그대로다', async () => {
    expect(await service.reconnect(ROOM)).toEqual({ roomId: ROOM, phase: 'playing' })
  })

  it('로비 복귀는 상태를 버리고 phase를 waiting으로 되돌린다', async () => {
    await service.start(ROOM, humans())
    sent = []

    await service.reset(ROOM)

    expect(await store.find(ROOM)).toBeNull()
    expect(phases).toEqual(['playing', 'waiting'])
    expect(types()).toEqual(['game.duel.state.sync'])
    expect(sent[0]?.message.payload).toEqual({
      snapshot: { roomId: ROOM, phase: 'playing' },
    })
  })

  it('resume은 종료된 결투를 다시 예약하지 않는다', async () => {
    await service.start(ROOM, humans())
    await service.removePlayer(ROOM, HOST)
    const before = scheduler.scheduled.length

    await service.resume(ROOM)

    expect(scheduler.scheduled.length).toBe(before)
  })

  it('resume은 진행 중 결투의 마감을 되살린다', async () => {
    await service.start(ROOM, humans())
    const before = scheduler.scheduled.length

    await service.resume(ROOM)

    expect(scheduler.scheduled.length).toBe(before + 1)
    expect(scheduler.scheduled.at(-1)?.version).toBe(1)
  })

  it('close는 타이머와 상태를 함께 버린다', async () => {
    await service.start(ROOM, humans())

    expect(await service.hasState(ROOM)).toBe(true)
    await service.close(ROOM)

    expect(await service.hasState(ROOM)).toBe(false)
    expect(scheduler.cancelled).toBeGreaterThan(0)
  })
})
