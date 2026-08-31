import type {
  DeadlineExecutor,
  DiceHoldPayload,
  DiceRollPayload,
  RoundRoomSnapshot,
  RoundState,
  RoundSubmitPayload,
  ScheduledTimeout,
} from '../../../round/index.js'
import {
  createScoreBoard,
  isUpperCategory,
  type ScoreBoard,
  type ScoreBoardStore,
  type ScoreCategory,
  UPPER_BONUS_SCORE,
  UPPER_BONUS_THRESHOLD,
} from '../../../score/index.js'
import type {
  YachtBotActions,
  YachtBotRoomService,
  YachtBotRoundLookup,
  YachtBotScoreLookup,
} from '../botPorts.js'

/**
 * 봇 스위트가 공유하는 대역. 호출을 기록하는
 * `mock(RoomService)`·`mock(ScheduledExecutorService)` 자리다.
 *
 * 실시간 sleep도 가짜 타이머도 쓰지 않는다 — 지연 4종이 **얼마인지**는
 * `ManualExecutor`에 기록된 delayMs로 검증하고, 발화 순서는 테스트가 직접 정한다
 * (마감 스케줄러가 인라인
 * executor를 둔 것과 같은 이유다).
 */

export interface ScheduledTask {
  readonly delayMs: number
  readonly run: () => void | Promise<void>
  cancelled: boolean
}

/** `DeadlineExecutor`의 수동 구현 — 예약만 기록하고 테스트가 골라 발화시킨다. */
export class ManualExecutor implements DeadlineExecutor {
  readonly tasks: ScheduledTask[] = []

  schedule(task: () => void, delayMs: number): ScheduledTimeout {
    const entry: ScheduledTask = { delayMs, run: task, cancelled: false }
    this.tasks.push(entry)
    return {
      cancel: () => {
        entry.cancelled = true
      },
    }
  }

  /** 예약된 작업 하나를 발화한다. 취소된 것은 발화하지 않는다(실수 방어). */
  async fire(index: number): Promise<void> {
    const task = this.tasks[index]
    if (task === undefined) throw new Error(`예약되지 않은 작업 index=${index}`)
    if (task.cancelled) throw new Error(`취소된 작업을 발화하려 했다 index=${index}`)
    await task.run()
  }

  delays(): number[] {
    return this.tasks.map((task) => task.delayMs)
  }
}

export interface RecordedAction<P> {
  readonly roomId: string
  readonly actorId: string
  readonly payload: P
  readonly msgId: string | null
}

/**
 * `YachtTurnActionService`의 자리. 호출을 기록하고 미리 넣어 둔 상태를 돌려준다.
 *
 * `delegate`를 주면 그쪽으로 그대로 통과시킨다 — 완주 통합 테스트가 **진짜**
 * 행동 서비스를 쓰면서 호출 이력만 보려고 쓴다.
 */
export class RecordingBotActions implements YachtBotActions {
  readonly rolls: RecordedAction<DiceRollPayload>[] = []
  readonly holds: RecordedAction<DiceHoldPayload>[] = []
  readonly submits: RecordedAction<RoundSubmitPayload>[] = []
  rollResult: RoundState | null = null
  holdResult: RoundState | null = null

  constructor(private readonly delegate?: YachtBotActions) {}

  async roll(
    roomId: string,
    actorId: string,
    payload: DiceRollPayload,
    msgId: string | null,
  ): Promise<RoundState> {
    this.rolls.push({ roomId, actorId, payload, msgId })
    if (this.delegate !== undefined) return this.delegate.roll(roomId, actorId, payload, msgId)
    if (this.rollResult === null) throw new Error('rollResult를 먼저 설정해야 한다')
    return this.rollResult
  }

  async hold(
    roomId: string,
    actorId: string,
    payload: DiceHoldPayload,
    msgId: string | null,
  ): Promise<RoundState> {
    this.holds.push({ roomId, actorId, payload, msgId })
    if (this.delegate !== undefined) return this.delegate.hold(roomId, actorId, payload, msgId)
    if (this.holdResult === null) throw new Error('holdResult를 먼저 설정해야 한다')
    return this.holdResult
  }

  async submitScore(
    roomId: string,
    actorId: string,
    payload: RoundSubmitPayload,
    msgId: string | null,
  ): Promise<unknown> {
    this.submits.push({ roomId, actorId, payload, msgId })
    if (this.delegate !== undefined) {
      return this.delegate.submitScore(roomId, actorId, payload, msgId)
    }
    return undefined
  }

  reset(): void {
    this.rolls.length = 0
    this.holds.length = 0
    this.submits.length = 0
  }
}

/** `RoundSynchronizationService.findByRoomId`의 자리. 호출마다 다른 상태를 줄 수 있다. */
export class FakeBotRounds implements YachtBotRoundLookup {
  private readonly queued: (RoundState | undefined)[] = []
  current: RoundState | undefined
  readonly lookups: string[] = []

  async findByRoomId(roomId: string): Promise<RoundState | undefined> {
    this.lookups.push(roomId)
    if (this.queued.length > 0) return this.queued.shift()
    return this.current
  }

  /** 다음 조회들이 이 순서로 답한다 — "굴림 직전에 상태가 바뀌었다"를 재현한다. */
  queue(...states: (RoundState | undefined)[]): void {
    this.queued.push(...states)
  }
}

/** `RoomService.getSnapshot`의 자리 — roster와 gameId만 있으면 된다. */
export class FakeBotRooms implements YachtBotRoomService {
  constructor(private snapshot: RoundRoomSnapshot | null) {}

  async getSnapshot(): Promise<RoundRoomSnapshot | null> {
    return this.snapshot
  }

  set(snapshot: RoundRoomSnapshot | null): void {
    this.snapshot = snapshot
  }
}

/** `ScoreConfirmationService`의 조회 둘. */
export class FakeBotScores implements YachtBotScoreLookup {
  board: ScoreBoard = createScoreBoard({}, 0, 0, 0)
  open: readonly ScoreCategory[] | null = null

  async scoreBoard(): Promise<ScoreBoard> {
    return this.board
  }

  async openCategories(): Promise<readonly ScoreCategory[]> {
    if (this.open === null) throw new Error('open을 먼저 설정해야 한다')
    return this.open
  }
}

/**
 * 점수를 실제로 **누적**하는 저장소 — 완주 테스트가 12칸이 다 차는지 보려면
 * 야추 스위트의 `FakeScoreBoardStore`(매번 새 점수판)로는 안 된다.
 * `YachtBotGameCompletionTest.InMemoryScoreBoardStore`와 같은 역할이다.
 */
export class AccumulatingScoreBoardStore implements ScoreBoardStore {
  private readonly byPlayer = new Map<string, Map<ScoreCategory, number>>()

  async confirmScore(
    _gameId: string,
    playerId: string,
    _roundNumber: number,
    category: ScoreCategory,
    score: number,
  ): Promise<ScoreBoard> {
    const scores = this.byPlayer.get(playerId) ?? new Map<ScoreCategory, number>()
    this.byPlayer.set(playerId, scores)
    if (scores.has(category)) {
      throw new Error(`category already used: ${category}`)
    }
    scores.set(category, score)
    return boardOf(scores)
  }

  async findScoreBoard(_gameId: string, playerId: string): Promise<ScoreBoard> {
    return boardOf(this.byPlayer.get(playerId) ?? new Map())
  }
}

const boardOf = (scores: ReadonlyMap<ScoreCategory, number>): ScoreBoard => {
  let upperSubtotal = 0
  let total = 0
  const categories: Record<string, number> = {}
  for (const [category, score] of scores) {
    categories[category] = score
    total += score
    if (isUpperCategory(category)) upperSubtotal += score
  }
  const upperBonus = upperSubtotal >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS_SCORE : 0
  return createScoreBoard(categories, upperSubtotal, upperBonus, total + upperBonus)
}

/** `RoundRoomSnapshot` 한 줄 생성기. `kind`는 1.6의 `room:{code}:bots` 마커에서 온 값이다. */
export const roomWith = (
  gameId: string | null,
  players: readonly { playerId: string; kind: 'HUMAN' | 'BOT' }[],
): RoundRoomSnapshot => ({ gameId, players })
