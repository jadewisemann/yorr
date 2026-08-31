import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { Redis } from 'ioredis'
import { ConflictError } from '../../errors.js'
import { registerLuaScripts, runLua } from '../../infra/lua.js'
import { gameStateKey, ROOM_KEY_PREFIX, roomKey } from '../../room/keys.js'
import { YACHT_DICE } from '../catalog.js'
import {
  type RoundState,
  type RoundStateStore,
  type RoundSubmission,
  type RoundSubmissionResult,
  RoundSynchronizationError,
} from '../round/index.js'
import { YACHT_SCRIPTS, YACHT_UNLOCK_STATE } from './scripts.js'
import { deserializeState, serializeState } from './yachtDiceStateSnapshot.js'

/** 락 TTL. 이 안에서 read-modify-write(+점수 확정 Lua)가 끝난다는 전제다. */
export const LOCK_TTL_MS = 5_000

/** 락 대기 예산. 넘기면 `game_state_busy`. */
export const LOCK_WAIT_MS = 2_000

/** 스핀 간격. */
export const LOCK_RETRY_MS = 10

const STATE_KEY_SUFFIX = `:game:${YACHT_DICE}:state`

export interface RedisYachtDiceStateStoreOptions {
  readonly lockTtlMs?: number
  readonly lockWaitMs?: number
  readonly lockRetryMs?: number
  /** 대기 예산 계산의 시계. 테스트가 대기 없이 만료를 만들 때 쓴다. */
  readonly now?: () => number
}

interface Change<T> {
  readonly state: RoundState
  readonly result: T
}

/**
 * 야추 라운드 상태의 운영 저장소.
 *
 * 2.4가 정의한 `RoundStateStore` 포트를 Redis로 구현한다. 인메모리 구현이
 * **방 단위 프라미스 체인 락**으로 얻던 "검증 → 콜백 → 커밋" 원자성을, 여기서는
 * **Redis 방 락**(`…:state:lock`, SET NX PX, 토큰 비교 해제)으로 얻는다.
 *
 * 왜 Lua 하나가 아니라 락인가: 상태 전이가 JSON 스냅샷을 도메인 객체로 되살려
 * `RoundState`의 검증을 통과시키는 일이고, `submitAtomically`의 `beforeStateChange`가
 * **또 다른 Lua**(CONFIRM_SCORE)다. Lua 안에서 Lua를 부를 수 없으므로 Java도 락을
 * 골랐다(원본 코드의 ponytail 주석: 작업이 5초를 넘기면 상태+점수를 한 Lua로 합칠 것).
 *
 * TTL은 **독립적으로 걸지 않는다** — 쓸 때마다 방 키의 PTTL을 복사한다. 방보다
 * 오래 사는 게임 상태는 고아이고, 방보다 먼저 죽는 상태는 진행 중 게임을 날린다.
 */
export class RedisYachtDiceStateStore implements RoundStateStore {
  private readonly redis: Redis
  private readonly lockTtlMs: number
  private readonly lockWaitMs: number
  private readonly lockRetryMs: number
  private readonly now: () => number

  constructor(redis: Redis, options: RedisYachtDiceStateStoreOptions = {}) {
    this.redis = redis
    registerLuaScripts(redis, YACHT_SCRIPTS)
    this.lockTtlMs = options.lockTtlMs ?? LOCK_TTL_MS
    this.lockWaitMs = options.lockWaitMs ?? LOCK_WAIT_MS
    this.lockRetryMs = options.lockRetryMs ?? LOCK_RETRY_MS
    this.now = options.now ?? Date.now
  }

  /**
   * SETNX 시맨틱 — 락을 쓰지 않는다(SET NX 자체가 원자적이다, Java와 같음).
   * 이중 초기화는 `ROUND_ALREADY_INITIALIZED`.
   */
  async initialize(roomId: string, initialState: RoundState): Promise<void> {
    validateRoomId(roomId)
    const created = await this.redis.set(stateKey(roomId), this.serialize(initialState), 'NX')
    if (created !== 'OK') {
      throw new RoundSynchronizationError(
        'ROUND_ALREADY_INITIALIZED',
        `round state already initialized for room: ${roomId}`,
      )
    }
    await this.copyRoomTtl(roomId)
  }

  async submitAtomically(
    roomId: string,
    submission: RoundSubmission,
    beforeStateChange: () => void | Promise<void>,
  ): Promise<RoundSubmissionResult> {
    return this.mutateRequired(roomId, async (current) => {
      // 검증이 먼저다. 점수 확정(콜백)은 유효한 제출에만 돌고, 던지면 상태는 무변화다.
      const result = current.submit(submission)
      await beforeStateChange()
      return { state: result.state, result }
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
    return this.mutateRequired(roomId, (current) => {
      const next = current.recordRoll(playerId, roundNumber, rollCount, held, rolledDice)
      return { state: next, result: next }
    })
  }

  async recordHoldAtomically(
    roomId: string,
    playerId: string,
    roundNumber: number,
    held: readonly boolean[],
  ): Promise<RoundState> {
    return this.mutateRequired(roomId, (current) => {
      const next = current.recordHold(playerId, roundNumber, held)
      return { state: next, result: next }
    })
  }

  async autoRollAtomically(
    roomId: string,
    expectedRoundNumber: number,
    expectedActivePlayerId: string,
    rolledDice: readonly number[],
  ): Promise<RoundState | undefined> {
    return this.mutateOptional(roomId, (current) => {
      if (
        isStaleTurn(current, expectedRoundNumber, expectedActivePlayerId) ||
        !current.hasRollsLeft
      ) {
        return undefined
      }
      const next = current.autoRoll(rolledDice)
      return { state: next, result: next }
    })
  }

  async expireAtomically(
    roomId: string,
    expectedRoundNumber: number,
    expectedActivePlayerId: string,
  ): Promise<RoundSubmissionResult | undefined> {
    return this.mutateOptional(roomId, (current) => {
      if (isStaleTurn(current, expectedRoundNumber, expectedActivePlayerId)) return undefined
      const result = current.expire()
      return { state: result.state, result }
    })
  }

  async removeParticipantAtomically(
    roomId: string,
    playerId: string,
  ): Promise<RoundState | undefined> {
    return this.mutateOptional(roomId, (current) => {
      const next = current.withoutParticipant(playerId)
      return { state: next, result: next }
    })
  }

  async findByRoomId(roomId: string): Promise<RoundState | undefined> {
    validateRoomId(roomId)
    const stored = await this.redis.get(stateKey(roomId))
    return stored === null ? undefined : this.deserialize(stored)
  }

  /**
   * 라운드 상태를 들고 있는 방 목록. **야추 상태만 SCAN한다** — 스위퍼(2.8)가
   * duel·pingpong 상태를 걷어가면 안 된다(game-modules.md 「스위퍼」).
   */
  async roomIds(): Promise<string[]> {
    const pattern = `${ROOM_KEY_PREFIX}*${STATE_KEY_SUFFIX}`
    const roomIds = new Set<string>()
    let cursor = '0'
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = next
      for (const key of keys) {
        roomIds.add(key.slice(ROOM_KEY_PREFIX.length, key.length - STATE_KEY_SUFFIX.length))
      }
    } while (cursor !== '0')
    return [...roomIds]
  }

  async remove(roomId: string): Promise<boolean> {
    validateRoomId(roomId)
    return (await this.redis.del(stateKey(roomId))) > 0
  }

  private async mutateRequired<T>(
    roomId: string,
    mutation: (current: RoundState) => Promise<Change<T> | undefined> | Change<T> | undefined,
  ): Promise<T> {
    const result = await this.mutateOptional(roomId, mutation)
    if (result === undefined) {
      throw new RoundSynchronizationError(
        'ROUND_NOT_INITIALIZED',
        `round state is not initialized for room: ${roomId}`,
      )
    }
    return result
  }

  private async mutateOptional<T>(
    roomId: string,
    mutation: (current: RoundState) => Promise<Change<T> | undefined> | Change<T> | undefined,
  ): Promise<T | undefined> {
    validateRoomId(roomId)
    return this.withLock(roomId, async () => {
      const stored = await this.redis.get(stateKey(roomId))
      if (stored === null) return undefined
      const change = await mutation(this.deserialize(stored))
      if (change === undefined) return undefined
      await this.redis.set(stateKey(roomId), this.serialize(change.state))
      await this.copyRoomTtl(roomId)
      return change.result
    })
  }

  /**
   * 방 락. SET NX PX로 잡고 최대 {@link LOCK_WAIT_MS}까지 스핀한다.
   *
   * 해제는 `finally`에서 **항상** 시도한다 — 락을 못 잡고 나가는 경로에서도 토큰이
   * 다르므로 no-op이다(그게 토큰 비교의 두 번째 역할이다).
   */
  private async withLock<T>(roomId: string, action: () => Promise<T>): Promise<T> {
    const lockKey = `${stateKey(roomId)}:lock`
    const token = randomUUID()
    const deadline = this.now() + this.lockWaitMs
    try {
      while ((await this.redis.set(lockKey, token, 'PX', this.lockTtlMs, 'NX')) !== 'OK') {
        if (this.now() >= deadline) throw new ConflictError('game_state_busy')
        await delay(this.lockRetryMs)
      }
      return await action()
    } finally {
      await runLua(this.redis, YACHT_UNLOCK_STATE, [lockKey], [token]).catch(() => {
        // 해제 실패는 삼킨다 — TTL이 5초 뒤에 같은 일을 한다. 여기서 던지면
        // 정상 처리된 전이의 결과를 잃는다(Java의 finally도 예외를 올리지 않는다).
      })
    }
  }

  private serialize(state: RoundState): string {
    try {
      return serializeState(state)
    } catch (error) {
      throw invalidYachtState(error)
    }
  }

  private deserialize(value: string): RoundState {
    try {
      return deserializeState(value)
    } catch (error) {
      throw invalidYachtState(error)
    }
  }

  /**
   * 방 키의 남은 TTL을 상태 키에 복사한다. 방에 TTL이 없거나 이미 사라졌으면
   * 아무것도 하지 않는다 — 그 경우 상태 키는 무기한으로 남고
   * 스위퍼(2.8)가 걷어간다.
   */
  private async copyRoomTtl(roomId: string): Promise<void> {
    const ttl = await this.redis.pttl(roomKey(roomId))
    if (ttl > 0) await this.redis.pexpire(stateKey(roomId), ttl)
  }
}

const stateKey = (roomId: string): string => gameStateKey(roomId, YACHT_DICE)

/**
 * Java `IllegalStateException("invalid_yacht_state", cause)` 자리.
 *
 * `CodedError`의 생성자는 코드 문자열만 받으므로(오류 계약이 그 문자열이다) 원인은
 * 표준 `Error.cause`에 따로 붙인다 — 손상된 스냅샷을 진단할 때 이것만이 단서다.
 */
const invalidYachtState = (cause: unknown): ConflictError => {
  const failure = new ConflictError('invalid_yacht_state')
  failure.cause = cause
  return failure
}

/** 인메모리 구현과 같은 모양. */
const validateRoomId = (roomId: string): void => {
  if (roomId.trim().length === 0) throw new Error('roomId must not be blank')
}

/**
 * 완료된 게임은 스테일 턴으로 취급한다 — 취소 직전에 발화한 타이머가 끝난 게임에서
 * 서버 대리 굴림을 하거나 라운드를 되살릴 수 없어야 한다(인메모리 구현과 동일 규칙).
 */
const isStaleTurn = (
  state: RoundState,
  expectedRoundNumber: number,
  expectedActivePlayerId: string,
): boolean =>
  state.finished ||
  state.roundNumber !== expectedRoundNumber ||
  state.activePlayerId !== expectedActivePlayerId
