import { RoundSynchronizationError } from './roundErrors.js'
import type { RoundRoll, RoundState, RoundSubmissionResult } from './roundState.js'
import type { RoundStateStore } from './roundStateStore.js'
import type { RoundSubmission } from './roundSubmission.js'

/**
 * 단일 인스턴스 인메모리 어댑터 — **테스트 시드**다. 운영은 Redis 어댑터가
 * 같은 포트를 구현한다(docs/design/game-modules.md 「저장소 포트」).
 *
 * 원자성은 **방 단위 프라미스 체인 락**으로 얻는다.
 * Node는 단일 스레드라 동기 구간은 원자적이지만 `beforeStateChange`를 await하는
 * 순간 같은 방의 다른 제출이 끼어들 수 있다 — 그러면 "두 개의 마지막 제출이
 * 라운드를 두 번 완료"가 실제로 가능해진다.
 *
 * 포트(`RoundStateStore`)에서 갈라 둔 이유: 포트는 계약이고 구현은 메커니즘이다.
 * 파일 하나에 두면 계약을 읽으려는 사람이 락 구현을 지나쳐야 한다.
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

  async recordRollAtomically(roomId: string, roll: RoundRoll): Promise<RoundState> {
    validateRoomId(roomId)
    return this.withRoomLock(roomId, () => {
      const currentState = this.states.get(roomId)
      if (currentState === undefined) throw notInitialized(roomId)
      const result = currentState.recordRoll(roll)
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

const ignore = (): void => {}
