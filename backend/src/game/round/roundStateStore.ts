import { RoundSynchronizationError } from './roundErrors.js'
import type { RoundState, RoundSubmissionResult } from './roundState.js'
import type { RoundSubmission } from './roundSubmission.js'

/**
 * 라운드 상태 저장소 포트.
 *
 * **모든 메서드가 async다** — 운영 어댑터는 Redis(방 락 + JSON 스냅샷)이고
 * `beforeStateChange`(점수 확정)도 Redis Lua라 동기일 수 없다. 인메모리 구현은
 * 방 단위 프라미스 락으로 "검증 → 콜백 → 커밋" 구간의 끼어들기를 막아 같은
 * 계약을 지킨다.
 */
export interface RoundStateStore {
  /** SETNX 시맨틱 — 이중 초기화는 `ROUND_ALREADY_INITIALIZED`. */
  initialize(roomId: string, initialState: RoundState): Promise<void>

  /**
   * 제출 하나를 적용하고 결과 상태를 저장하는 것을 **한 덩어리로** 처리한다.
   * 두 개의 마지막 제출이 같은 라운드를 두 번 완료시키지 못해야 한다.
   *
   * `beforeStateChange`는 **라운드 검증 후·상태 커밋 전**에 실행된다. 던지면
   * 라운드 상태는 무변화 — 점수 저장이 실패한 플레이어가 미제출로 남아 재시도할
   * 수 있는 근간이다(docs/design/game-modules.md 「불변식」).
   */
  submitAtomically(
    roomId: string,
    submission: RoundSubmission,
    beforeStateChange: () => void | Promise<void>,
  ): Promise<RoundSubmissionResult>

  recordRollAtomically(
    roomId: string,
    playerId: string,
    roundNumber: number,
    rollCount: number,
    held: readonly boolean[],
    rolledDice: readonly number[],
  ): Promise<RoundState>

  /** 굴림 사이에 활성 플레이어가 바꾼 KEEP을 저장한다. */
  recordHoldAtomically(
    roomId: string,
    playerId: string,
    roundNumber: number,
    held: readonly boolean[],
  ): Promise<RoundState>

  /**
   * 활성 플레이어를 대신해 한 번 굴린다. 단 **기대한 턴이 아직 현재일 때만**,
   * 그리고 굴림이 남아 있을 때만. 턴이 이미 지났거나 굴림을 다 썼으면 undefined —
   * 호출자는 그때 점수 기록으로 넘어간다.
   */
  autoRollAtomically(
    roomId: string,
    expectedRoundNumber: number,
    expectedActivePlayerId: string,
    rolledDice: readonly number[],
  ): Promise<RoundState | undefined>

  /**
   * 기대한 턴이 아직 현재일 때만 무득점으로 턴을 넘긴다. 방이 사라졌거나 다른
   * 경로가 이미 진행시켰으면 undefined.
   */
  expireAtomically(
    roomId: string,
    expectedRoundNumber: number,
    expectedActivePlayerId: string,
  ): Promise<RoundSubmissionResult | undefined>

  /**
   * 이탈한 참가자를 턴 순서에서 뺀다(턴은 넘기지 않는다). 활성 플레이어라면
   * 먼저 `expireAtomically`로 넘겨야 한다. 라운드 상태가 없으면 undefined.
   */
  removeParticipantAtomically(roomId: string, playerId: string): Promise<RoundState | undefined>

  findByRoomId(roomId: string): Promise<RoundState | undefined>

  /**
   * 라운드 상태를 들고 있는 모든 방. 방이 사라졌는데도 남은 항목을 주기적으로
   * 걷어내는 스윕이 이 목록을 쓴다 — 이게 없으면 회수 경로가 유예 타이머
   * 하나뿐이고, 그 타이머는 프로세스 재시작에 사라져 아무도 치우지 않는 상태가 된다.
   */
  roomIds(): Promise<string[]>

  remove(roomId: string): Promise<boolean>
}

const validateRoomId = (roomId: string): void => {
  if (roomId.trim().length === 0) throw new Error('roomId must not be blank')
}

/**
 * 완료된 게임은 스테일 턴으로 취급한다 — 취소 직전에 발화한 타이머가 끝난
 * 게임에서 서버 대리 굴림을 하거나 라운드를 되살릴 수 없어야 한다.
 */
const isStaleTurn = (
  currentState: RoundState,
  expectedRoundNumber: number,
  expectedActivePlayerId: string,
): boolean =>
  currentState.finished ||
  currentState.roundNumber !== expectedRoundNumber ||
  currentState.activePlayerId !== expectedActivePlayerId

const notInitialized = (roomId: string): RoundSynchronizationError =>
  new RoundSynchronizationError(
    'ROUND_NOT_INITIALIZED',
    `round state is not initialized for room: ${roomId}`,
  )

/**
 * 단일 인스턴스 인메모리 어댑터 — **테스트 시드**다. 운영은 Redis 어댑터가
 * 같은 포트를 구현한다(docs/design/game-modules.md 「저장소 포트」).
 *
 * 원자성은 **방 단위 프라미스 체인 락**으로 얻는다.
 * Node는 단일 스레드라 동기 구간은 원자적이지만 `beforeStateChange`를 await하는
 * 순간 같은 방의 다른 제출이 끼어들 수 있다 — 그러면 "두 개의 마지막 제출이
 * 라운드를 두 번 완료"가 실제로 가능해진다.
 */
export class InMemoryRoundStateStore implements RoundStateStore {
  private readonly states = new Map<string, RoundState>()
  private readonly locks = new Map<string, Promise<unknown>>()

  async initialize(roomId: string, initialState: RoundState): Promise<void> {
    validateRoomId(roomId)
    return this.withRoomLock(roomId, () => {
      if (this.states.has(roomId)) {
        throw new RoundSynchronizationError(
          'ROUND_ALREADY_INITIALIZED',
          `round state already initialized for room: ${roomId}`,
        )
      }
      this.states.set(roomId, initialState)
    })
  }

  async submitAtomically(
    roomId: string,
    submission: RoundSubmission,
    beforeStateChange: () => void | Promise<void>,
  ): Promise<RoundSubmissionResult> {
    validateRoomId(roomId)
    return this.withRoomLock(roomId, async () => {
      const currentState = this.states.get(roomId)
      if (currentState === undefined) throw notInitialized(roomId)
      // 검증이 먼저다. 콜백은 유효한 제출에 대해서만 돈다.
      const result = currentState.submit(submission)
      await beforeStateChange()
      this.states.set(roomId, result.state)
      return result
    })
  }

  async recordRollAtomically(
    roomId: string,
    playerId: string,
    roundNumber: number,
    rollCount: number,
    held: readonly boolean[],
    rolledDice: readonly number[],
  ): Promise<RoundState> {
    validateRoomId(roomId)
    return this.withRoomLock(roomId, () => {
      const currentState = this.states.get(roomId)
      if (currentState === undefined) throw notInitialized(roomId)
      const result = currentState.recordRoll(playerId, roundNumber, rollCount, held, rolledDice)
      this.states.set(roomId, result)
      return result
    })
  }

  async recordHoldAtomically(
    roomId: string,
    playerId: string,
    roundNumber: number,
    held: readonly boolean[],
  ): Promise<RoundState> {
    validateRoomId(roomId)
    return this.withRoomLock(roomId, () => {
      const currentState = this.states.get(roomId)
      if (currentState === undefined) throw notInitialized(roomId)
      const result = currentState.recordHold(playerId, roundNumber, held)
      this.states.set(roomId, result)
      return result
    })
  }

  async autoRollAtomically(
    roomId: string,
    expectedRoundNumber: number,
    expectedActivePlayerId: string,
    rolledDice: readonly number[],
  ): Promise<RoundState | undefined> {
    validateRoomId(roomId)
    return this.withRoomLock(roomId, () => {
      const currentState = this.states.get(roomId)
      if (currentState === undefined) return undefined
      if (
        isStaleTurn(currentState, expectedRoundNumber, expectedActivePlayerId) ||
        !currentState.hasRollsLeft
      ) {
        return undefined
      }
      const result = currentState.autoRoll(rolledDice)
      this.states.set(roomId, result)
      return result
    })
  }

  async expireAtomically(
    roomId: string,
    expectedRoundNumber: number,
    expectedActivePlayerId: string,
  ): Promise<RoundSubmissionResult | undefined> {
    validateRoomId(roomId)
    return this.withRoomLock(roomId, () => {
      const currentState = this.states.get(roomId)
      if (currentState === undefined) return undefined
      if (isStaleTurn(currentState, expectedRoundNumber, expectedActivePlayerId)) return undefined
      const result = currentState.expire()
      this.states.set(roomId, result.state)
      return result
    })
  }

  async removeParticipantAtomically(
    roomId: string,
    playerId: string,
  ): Promise<RoundState | undefined> {
    validateRoomId(roomId)
    return this.withRoomLock(roomId, () => {
      const currentState = this.states.get(roomId)
      if (currentState === undefined) return undefined
      const result = currentState.withoutParticipant(playerId)
      this.states.set(roomId, result)
      return result
    })
  }

  async findByRoomId(roomId: string): Promise<RoundState | undefined> {
    validateRoomId(roomId)
    return this.states.get(roomId)
  }

  async roomIds(): Promise<string[]> {
    // 스윕이 순회 중 remove를 호출하므로 살아있는 keys()를 그대로 주면 안 된다.
    return [...this.states.keys()]
  }

  async remove(roomId: string): Promise<boolean> {
    validateRoomId(roomId)
    return this.states.delete(roomId)
  }

  /** 같은 방의 전이를 직렬화한다. 다른 방끼리는 서로 기다리지 않는다. */
  private async withRoomLock<T>(roomId: string, task: () => Promise<T> | T): Promise<T> {
    const previous = this.locks.get(roomId) ?? Promise.resolve()
    // 앞 작업이 실패해도 뒤 작업은 실행돼야 한다 — 두 핸들러 모두 task.
    const run = previous.then(task, task)
    const tail = run.then(ignore, ignore)
    this.locks.set(roomId, tail)
    try {
      return await run
    } finally {
      if (this.locks.get(roomId) === tail) this.locks.delete(roomId)
    }
  }
}

const ignore = (): void => {}
