import { describe, expect, it } from 'vitest'
import { DavinciGameService, type DavinciStartRoster } from '../davinciGameService.js'
import type {
  DavinciAudience,
  DavinciCompletionPort,
  DavinciDeadlineScheduler,
  DavinciMarkablePhase,
  DavinciOutboundEnvelope,
  DavinciPresence,
  DavinciRoomSnapshotPort,
  DavinciScoreboardPort,
  DavinciSeat,
} from '../davinciPorts.js'
import { DAVINCI_DECK_SIZE, GUESS_MILLIS } from '../davinciRules.js'
import type { DavinciState, DavinciTileView, DavinciView } from '../davinciState.js'
import type { DavinciStateStore } from '../davinciStateStore.js'

const ROOM = 'ROOM1'
const HOST = 'player-1'
const GUEST = 'player-2'
const DASHBOARD = 'dashboard-1'
const NOW = 1_700_000_000_000

interface FakeSnapshot {
  readonly roomId: string
  readonly phase: string
}

/** 스토어의 계약(version 비증가 무시)만 지키는 인메모리 대역. */
class InMemoryDavinciStateStore implements DavinciStateStore {
  private readonly states = new Map<string, DavinciState>()

  async initialize(roomId: string, state: DavinciState): Promise<void> {
    if (this.states.has(roomId)) throw new Error('davinci_already_initialized')
    this.states.set(roomId, state)
  }

  async find(roomId: string): Promise<DavinciState | null> {
    return this.states.get(roomId) ?? null
  }

  async mutate(
    roomId: string,
    mutation: (current: DavinciState) => DavinciState | null,
  ): Promise<DavinciState | null> {
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

class FakeScheduler implements DavinciDeadlineScheduler {
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

  async fireLatest(): Promise<void> {
    const latest = this.scheduled.at(-1)
    if (latest === undefined) throw new Error('예약된 마감이 없다')
    await latest.action()
  }
}

interface SentFrame {
  readonly to: string
  readonly message: DavinciOutboundEnvelope
}

/** 좌석 목록을 고정한 관객 대역 — 누구에게 무엇이 갔는지 그대로 남긴다. */
class FakeAudience implements DavinciAudience<string> {
  readonly sent: SentFrame[] = []

  constructor(private seats: DavinciSeat<string>[]) {}

  membersOf(): readonly DavinciSeat<string>[] {
    return this.seats
  }

  send(socket: string, message: DavinciOutboundEnvelope): void {
    this.sent.push({ to: socket, message })
  }

  goOffline(playerId: string): void {
    this.seats = this.seats.map((seat) =>
      seat.playerId === playerId ? { ...seat, socket: null } : seat,
    )
  }

  framesFor(playerId: string, type: string): DavinciOutboundEnvelope[] {
    return this.sent
      .filter((frame) => frame.to === playerId && frame.message.type === type)
      .map((frame) => frame.message)
  }
}

class FakePresence implements DavinciPresence {
  readonly phases: DavinciMarkablePhase[] = []
  markPhase(_roomId: string, phase: DavinciMarkablePhase): void {
    this.phases.push(phase)
  }
}

class FakeSnapshots implements DavinciRoomSnapshotPort<FakeSnapshot> {
  async snapshot(roomId: string): Promise<FakeSnapshot> {
    return { roomId, phase: 'playing' }
  }
}

class FakeCompletion implements DavinciCompletionPort {
  forced = 0
  async finishIfComplete(_roomId: string, force: boolean): Promise<boolean> {
    if (force) this.forced += 1
    return true
  }
}

class FakeScoreboard implements DavinciScoreboardPort {
  written: ReadonlyMap<string, number> | null = null
  async writeScores(_roomId: string, scores: ReadonlyMap<string, number>): Promise<void> {
    this.written = scores
  }
}

/** 테스트가 판을 고정한다: 앞 여덟 장이 손패(검정 0~7), 아홉 번째가 첫 턴에 뽑는 타일이다. */
const fixedOrder = (): readonly number[] =>
  Array.from({ length: DAVINCI_DECK_SIZE }, (_, index) => index)

const roster: DavinciStartRoster = {
  hostId: HOST,
  players: [
    { playerId: GUEST, kind: 'HUMAN' },
    { playerId: HOST, kind: 'HUMAN' },
    { playerId: 'bot-1', kind: 'BOT' },
  ],
}

interface Harness {
  readonly service: DavinciGameService<FakeSnapshot, string>
  readonly states: InMemoryDavinciStateStore
  readonly scheduler: FakeScheduler
  readonly audience: FakeAudience
  readonly presence: FakePresence
  readonly completion: FakeCompletion
  readonly scoreboard: FakeScoreboard
}

const harness = (): Harness => {
  const states = new InMemoryDavinciStateStore()
  const scheduler = new FakeScheduler()
  const audience = new FakeAudience([
    { playerId: HOST, socket: HOST },
    { playerId: GUEST, socket: GUEST },
    { playerId: DASHBOARD, socket: DASHBOARD },
  ])
  const presence = new FakePresence()
  const completion = new FakeCompletion()
  const scoreboard = new FakeScoreboard()
  const service = new DavinciGameService<FakeSnapshot, string>(
    {
      states,
      scheduler,
      audience,
      realtimeSnapshots: new FakeSnapshots(),
      presence,
      completion,
      scoreboard,
    },
    { now: () => NOW, shuffle: fixedOrder },
  )
  return { service, states, scheduler, audience, presence, completion, scoreboard }
}

const started = async (): Promise<Harness> => {
  const context = harness()
  await context.service.start(ROOM, roster)
  return context
}

const stateOf = async (context: Harness): Promise<DavinciState> => {
  const state = await context.states.find(ROOM)
  if (state === null) throw new Error('상태가 없다')
  return state
}

const viewIn = (message: DavinciOutboundEnvelope): DavinciView => message.payload as DavinciView

/** 그 좌석이 처음 받은 상태 프레임의 시점. */
const firstView = (context: Harness, playerId: string): DavinciView => {
  const [message] = context.audience.framesFor(playerId, 'game.davinci_code.state')
  if (message === undefined) throw new Error(`${playerId} 좌석이 상태를 받지 못했다`)
  return viewIn(message)
}

const tileNumbers = (view: DavinciView, playerId: string): (number | null)[] =>
  (view.hands[playerId] ?? []).map((tile: DavinciTileView) => tile.number)

describe('시작', () => {
  it('호스트가 첫 자리이고 봇은 명단에서 걸러진다', async () => {
    const context = await started()
    const state = await stateOf(context)

    expect(state.playerOrder).toEqual([HOST, GUEST])
    expect(state.turnPlayerId).toBe(HOST)
    expect(context.presence.phases).toEqual(['playing'])
  })

  it('좌석마다 자기 숫자만 실린 시점을 받는다', async () => {
    const context = await started()

    const forHost = firstView(context, HOST)
    const forGuest = firstView(context, GUEST)

    expect(tileNumbers(forHost, HOST).every((number) => number !== null)).toBe(true)
    expect(tileNumbers(forHost, GUEST).every((number) => number === null)).toBe(true)
    expect(tileNumbers(forGuest, GUEST).every((number) => number !== null)).toBe(true)
    expect(tileNumbers(forGuest, HOST).every((number) => number === null)).toBe(true)
  })

  it('플레이어가 아닌 파티 대시보드는 감춘 숫자를 하나도 받지 않는다', async () => {
    const context = await started()

    const forDashboard = firstView(context, DASHBOARD)

    expect(tileNumbers(forDashboard, HOST).every((number) => number === null)).toBe(true)
    expect(tileNumbers(forDashboard, GUEST).every((number) => number === null)).toBe(true)
    expect(forDashboard.drawn?.number).toBeNull()
  })

  it('첫 턴의 마감을 예약한다', async () => {
    const context = await started()

    expect(context.scheduler.scheduled).toHaveLength(1)
    expect(context.scheduler.scheduled[0]?.deadline).toBe(NOW + GUESS_MILLIS)
  })

  it('사람이 한 명뿐이면 시작을 거부한다', async () => {
    const context = harness()

    await expect(
      context.service.start(ROOM, { hostId: HOST, players: [{ playerId: HOST, kind: 'HUMAN' }] }),
    ).rejects.toThrow('davinci_requires_two_to_four_players')
  })
})

describe('진행', () => {
  it('맞히면 계속할지 고르는 단계가 되고 새 마감이 잡힌다', async () => {
    const context = await started()
    const state = await stateOf(context)
    const tile = state.hands[GUEST]?.[0]

    await context.service.guess(ROOM, HOST, {
      inputSeq: 0,
      targetId: GUEST,
      tileId: tile?.id ?? '',
      number: tile?.number ?? 0,
    })

    expect((await stateOf(context)).phase).toBe('DECIDING')
    expect(context.scheduler.scheduled).toHaveLength(2)
  })

  it('내 차례가 아닌 입력은 아무것도 바꾸지 않고 방송도 없다', async () => {
    const context = await started()
    const before = await stateOf(context)
    const sentBefore = context.audience.sent.length
    const tile = before.hands[HOST]?.[0]

    await context.service.guess(ROOM, GUEST, {
      inputSeq: 0,
      targetId: HOST,
      tileId: tile?.id ?? '',
      number: tile?.number ?? 0,
    })

    expect((await stateOf(context)).version).toBe(before.version)
    expect(context.audience.sent).toHaveLength(sentBefore)
  })

  it('부를 수 없는 숫자는 도메인 오류다', async () => {
    const context = await started()

    await expect(
      context.service.guess(ROOM, HOST, {
        inputSeq: 0,
        targetId: GUEST,
        tileId: 'T4',
        number: 12,
      }),
    ).rejects.toThrow('invalid_davinci_guess')
  })

  it('제한 시간이 지나면 턴이 넘어간다', async () => {
    const context = await started()

    await context.scheduler.fireLatest()

    const state = await stateOf(context)
    expect(state.turnPlayerId).toBe(GUEST)
    expect(state.lastEvent?.kind).toBe('TIMEOUT')
  })

  it('지나간 버전의 마감은 발화해도 아무 일이 없다', async () => {
    const context = await started()
    const stale = context.scheduler.scheduled[0]
    await context.scheduler.fireLatest()
    const after = await stateOf(context)

    await stale?.action()

    expect((await stateOf(context)).version).toBe(after.version)
  })

  it('연결이 끊긴 좌석에는 보내지 않는다', async () => {
    const context = await started()
    context.audience.goOffline(GUEST)
    const before = context.audience.framesFor(GUEST, 'game.davinci_code.state').length

    await context.scheduler.fireLatest()

    expect(context.audience.framesFor(GUEST, 'game.davinci_code.state')).toHaveLength(before)
  })
})

describe('종료', () => {
  /** 상대 타일을 전부 맞혀 판을 끝낸다. */
  const finish = async (context: Harness): Promise<void> => {
    let seq = 0
    for (let index = 0; index < 4; index += 1) {
      const state = await stateOf(context)
      if (state.phase === 'DECIDING') {
        await context.service.decide(ROOM, HOST, { inputSeq: seq, decision: 'CONTINUE' })
        seq += 1
      }
      const current = await stateOf(context)
      const tile = (current.hands[GUEST] ?? []).find((candidate) => !candidate.revealed)
      if (tile === undefined) break
      await context.service.guess(ROOM, HOST, {
        inputSeq: seq,
        targetId: GUEST,
        tileId: tile.id,
        number: tile.number,
      })
      seq += 1
    }
  }

  it('점수를 기록하고 완료 판정을 강제로 부른다', async () => {
    const context = await started()

    await finish(context)

    const state = await stateOf(context)
    expect(state.phase).toBe('FINISHED')
    expect(state.winnerId).toBe(HOST)
    expect(context.completion.forced).toBe(1)
    // 이긴 쪽은 맞힌 넷 + 감춘 넷, 진 쪽은 남은 것이 없다.
    expect(context.scoreboard.written?.get(HOST)).toBe(8)
    expect(context.scoreboard.written?.get(GUEST)).toBe(0)
    expect(context.scheduler.cancelled).toBeGreaterThan(0)
  })
})

describe('이탈과 복구', () => {
  it('떠난 사람의 손패를 공개하고 남은 사람이 이긴다', async () => {
    const context = await started()

    await context.service.removePlayer(ROOM, GUEST)

    const state = await stateOf(context)
    expect(state.phase).toBe('FINISHED')
    expect(state.winnerId).toBe(HOST)
    expect(state.hands[GUEST]?.every((tile) => tile.revealed)).toBe(true)
  })

  it('재접속 스냅샷은 그 사람 시점이다', async () => {
    const context = await started()

    const snapshot = (await context.service.reconnect(ROOM, GUEST)) as FakeSnapshot & {
      game: DavinciView
    }

    expect(tileNumbers(snapshot.game, GUEST).every((number) => number !== null)).toBe(true)
    expect(tileNumbers(snapshot.game, HOST).every((number) => number === null)).toBe(true)
  })

  it('상태가 없으면 방 스냅샷만 돌려준다', async () => {
    const context = harness()

    const snapshot = await context.service.reconnect(ROOM, HOST)

    expect(snapshot).not.toHaveProperty('game')
  })

  it('재기동 복구는 마감을 되살리고, 이어갈 수 없으면 던진다', async () => {
    const context = await started()
    context.scheduler.scheduled.length = 0

    await context.service.rehydrate(ROOM)
    expect(context.scheduler.scheduled).toHaveLength(1)

    await expect(context.service.rehydrate('MISSING')).rejects.toThrow()
  })

  it('로비로 돌아가면 상태를 버리고 대기실 스냅샷을 다시 뿌린다', async () => {
    const context = await started()

    await context.service.reset(ROOM)

    expect(await context.states.find(ROOM)).toBeNull()
    expect(context.presence.phases).toEqual(['playing', 'waiting'])
    expect(context.audience.framesFor(HOST, 'game.davinci_code.state.sync').length).toBeGreaterThan(
      0,
    )
  })
})
