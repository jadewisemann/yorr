import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import { ConflictError } from '../../errors.js'
import { type LuaScript, registerLuaScripts, runLua } from '../../infra/lua.js'
import { gameStateKey, roomKey } from '../../room/keys.js'
import { DUEL_CODE } from './duelCode.js'
import type { DuelState } from './duelState.js'

/**
 * 진행 중 결투 상태의 저장소 — backend-java `RedisDuelStateStore`.
 *
 * 왜 락인가: 결투는 두 플레이어의 `draw`와 서버 타임아웃(신호·유예 만료·연출
 * 종료)이 **같은 밀리초에 도착할 수 있다**. read-modify-write를 그냥 하면 늦게 쓴
 * 쪽이 앞의 판정을 덮어써 "먼저 뽑았는데 안 맞은" 상태가 나온다. Java와 같은
 * SET NX 락 + 토큰 비교 해제를 쓴다(DESIGN.md 원칙 8 단일 인스턴스 전제).
 */
export interface DuelStateStore {
  /** 첫 초기화만 허용한다(SETNX). 이미 있으면 `duel_already_initialized`. */
  initialize(roomId: string, state: DuelState): Promise<void>

  find(roomId: string): Promise<DuelState | null>

  /**
   * 락 안에서 read → 규칙 적용 → write.
   *
   * @param mutation `null`을 돌려주면 "변이 없음". 규칙 함수가 **상태를 그대로**
   *   돌려주는 경우(= version 비증가)도 같게 취급한다.
   * @returns 실제로 저장된 새 상태. 변이가 없었으면 `null`(방송·재예약 금지 신호).
   */
  mutate(
    roomId: string,
    mutation: (current: DuelState) => DuelState | null,
  ): Promise<DuelState | null>

  remove(roomId: string): Promise<boolean>
}

const LOCK_TTL_MILLIS = 5_000
const LOCK_WAIT_MILLIS = 2_000
const LOCK_RETRY_MILLIS = 10

/** 내가 잡은 락만 푼다 — TTL로 이미 넘어간 락을 남이 잡았을 때 그것까지 풀지 않게. */
const DUEL_UNLOCK: LuaScript = {
  name: 'duelUnlock',
  numberOfKeys: 1,
  lua: `
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
`,
}

const DUEL_SCRIPTS: readonly LuaScript[] = [DUEL_UNLOCK]

const stateKey = (roomId: string): string => {
  if (roomId.trim().length === 0) throw new Error('roomId must not be blank')
  return gameStateKey(roomId, DUEL_CODE)
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export class RedisDuelStateStore implements DuelStateStore {
  private readonly redis: Redis

  constructor(redis: Redis) {
    this.redis = redis
    registerLuaScripts(redis, DUEL_SCRIPTS)
  }

  async initialize(roomId: string, state: DuelState): Promise<void> {
    const created = await this.redis.set(stateKey(roomId), serialize(state), 'NX')
    if (created !== 'OK') throw new ConflictError('duel_already_initialized')
    await this.copyRoomTtl(roomId)
  }

  async find(roomId: string): Promise<DuelState | null> {
    const value = await this.redis.get(stateKey(roomId))
    return value === null ? null : deserialize(value)
  }

  async mutate(
    roomId: string,
    mutation: (current: DuelState) => DuelState | null,
  ): Promise<DuelState | null> {
    return this.withLock(roomId, async () => {
      const value = await this.redis.get(stateKey(roomId))
      if (value === null) return null
      const current = deserialize(value)
      const next = mutation(current)
      // **version이 오르지 않은 갱신은 버린다.** Java는 `==`만 비교하지만 여기서는
      // `<=`로 막는다 — 오래된 상태(재예약 전에 만들어진 스냅샷)를 그대로 쓰면
      // 새 판정이 조용히 지워지고, 방송도 스케줄도 과거로 되돌아간다.
      if (next === null || next.version <= current.version) return null
      await this.redis.set(stateKey(roomId), serialize(next))
      await this.copyRoomTtl(roomId)
      return next
    })
  }

  async remove(roomId: string): Promise<boolean> {
    return (await this.redis.del(stateKey(roomId))) > 0
  }

  /**
   * 게임 상태는 방보다 오래 살아서는 안 된다 — 방 키의 남은 TTL을 그대로 복사한다
   * (방 활동으로 TTL이 밀리면 다음 갱신에서 다시 따라간다).
   */
  private async copyRoomTtl(roomId: string): Promise<void> {
    const ttl = await this.redis.pttl(roomKey(roomId))
    if (ttl > 0) await this.redis.pexpire(stateKey(roomId), ttl)
  }

  private async withLock<T>(roomId: string, action: () => Promise<T>): Promise<T> {
    const lockKey = `${stateKey(roomId)}:lock`
    const token = randomUUID()
    const deadline = Date.now() + LOCK_WAIT_MILLIS
    while ((await this.redis.set(lockKey, token, 'PX', LOCK_TTL_MILLIS, 'NX')) !== 'OK') {
      if (Date.now() >= deadline) throw new ConflictError('game_state_busy')
      await sleep(LOCK_RETRY_MILLIS)
    }
    try {
      return await action()
    } finally {
      await runLua(this.redis, DUEL_UNLOCK, [lockKey], [token]).catch(() => 0)
    }
  }
}

const serialize = (state: DuelState): string => JSON.stringify(state)

/**
 * 저장된 값이 결투 상태가 아니면 **조용히 넘기지 않는다**(Java `invalid_duel_state`).
 * 배포 사이에 상태 모양이 바뀌면 여기서 드러나는 편이 낫다 — 반쪽 상태로 판정하면
 * 총알 수가 틀린 결투가 계속 진행된다.
 */
const deserialize = (value: string): DuelState => {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new ConflictError('invalid_duel_state')
  }
  if (!isDuelState(parsed)) throw new ConflictError('invalid_duel_state')
  return parsed
}

const isDuelState = (value: unknown): value is DuelState => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<DuelState>
  return (
    typeof candidate.version === 'number' &&
    typeof candidate.phase === 'string' &&
    Array.isArray(candidate.playerOrder) &&
    typeof candidate.hp === 'object' &&
    candidate.hp !== null
  )
}
