import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import { ConflictError } from '../errors.js'
import { type LuaScript, registerLuaScripts, runLua } from '../infra/lua.js'
import { gameStateKey, roomKey } from '../room/keys.js'

/** 버전으로 갱신 순서를 판정하는 게임 상태. */
export interface VersionedState {
  readonly version: number
}

/**
 * 진행 중 게임 상태 저장소의 계약. 게임마다 이름만 다른 별칭을 두어 호출부가 자기 게임의
 * 상태 타입으로 읽게 한다(`DuelStateStore` 등).
 */
export interface VersionedStateStore<S extends VersionedState> {
  /** 첫 초기화만 허용한다(SETNX). 이미 있으면 게임별 `*_already_initialized`. */
  initialize(roomId: string, state: S): Promise<void>

  find(roomId: string): Promise<S | null>

  /**
   * 락 안에서 read → 규칙 적용 → write.
   *
   * @param mutation `null`을 돌려주면 "변이 없음". 규칙 함수가 **상태를 그대로**
   * 돌려주는 경우(= version 비증가)도 같게 취급한다.
   * @returns 실제로 저장된 새 상태. 변이가 없었으면 `null`(방송·재예약 금지 신호).
   */
  mutate(roomId: string, mutation: (current: S) => S | null): Promise<S | null>

  remove(roomId: string): Promise<boolean>
}

/** 게임 코드로 고정한 상태 키 함수. 빈 roomId는 키를 만들기 전에 잡는다. */
export function gameStateKeyOf(code: string): (roomId: string) => string {
  return (roomId) => {
    if (roomId.trim().length === 0) throw new Error('roomId must not be blank')
    return gameStateKey(roomId, code)
  }
}

/**
 * 진행 중 게임 상태를 Redis에 두고 **락 안에서** 갱신하는 저장소.
 *
 * 다빈치·결투·탁구가 같은 것을 세 벌 갖고 있었다. 세 게임 모두 이유가 같다: 플레이어의
 * 입력과 서버 타임아웃이 **같은 밀리초에 도착할 수 있어서**, read-modify-write를 그냥
 * 하면 늦게 쓴 쪽이 앞의 판정을 덮어쓴다(공개된 타일이 다시 감춰지거나 지나간 턴이
 * 되살아난다). SET NX 락 + 토큰 비교 해제를 쓴다(DESIGN.md 원칙 8 단일 인스턴스 전제).
 *
 * **version이 오르지 않은 갱신은 버린다.** 같은 값 비교가 아니라 `<=`로 막는 이유는,
 * 오래된 상태(재예약 전에 만들어진 스냅샷)를 그대로 쓰면 새 판정이 조용히 지워지고
 * 방송도 스케줄도 과거로 되돌아가기 때문이다.
 */
export class RedisVersionedStateStore<S extends VersionedState> {
  private readonly unlock: LuaScript

  constructor(
    private readonly redis: Redis,
    private readonly options: {
      /** 이 게임의 상태 키. 게임 코드가 이미 들어 있어야 한다. */
      readonly stateKey: (roomId: string) => string
      /** 저장된 문자열을 상태로 되돌린다. 게임마다 검증이 다르다. */
      readonly parse: (raw: string) => S
      /** 이미 있는 방을 다시 초기화할 때 던질 코드(`duel_already_initialized` 등). */
      readonly alreadyInitializedCode: string
      /** 해제 스크립트 이름. 게임마다 달라야 등록이 겹치지 않는다. */
      readonly unlockScriptName: string
      readonly lockTtlMillis: number
      readonly lockWaitMillis: number
      readonly lockRetryMillis: number
    },
  ) {
    // 내가 잡은 락만 푼다 — TTL로 이미 넘어간 락을 남이 잡았을 때 그것까지 풀지 않게.
    this.unlock = {
      name: options.unlockScriptName,
      numberOfKeys: 1,
      lua: `
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
`,
    }
    registerLuaScripts(redis, [this.unlock])
  }

  /** 첫 초기화만 허용한다(SETNX). */
  async initialize(roomId: string, state: S): Promise<void> {
    const created = await this.redis.set(this.key(roomId), JSON.stringify(state), 'NX')
    if (created !== 'OK') throw new ConflictError(this.options.alreadyInitializedCode)
    await this.copyRoomTtl(roomId)
  }

  async find(roomId: string): Promise<S | null> {
    const value = await this.redis.get(this.key(roomId))
    return value === null ? null : this.options.parse(value)
  }

  /**
   * 락 안에서 read → 규칙 적용 → write.
   *
   * @param mutation `null`을 돌려주면 "변이 없음". 규칙 함수가 상태를 그대로 돌려준
   *   경우(= version 비증가)도 같게 취급한다.
   * @returns 실제로 저장된 새 상태. 변이가 없었으면 `null`(방송·재예약 금지 신호).
   */
  async mutate(roomId: string, mutation: (current: S) => S | null): Promise<S | null> {
    return this.withLock(roomId, async () => {
      const value = await this.redis.get(this.key(roomId))
      if (value === null) return null
      const current = this.options.parse(value)
      const next = mutation(current)
      if (next === null || next.version <= current.version) return null
      await this.redis.set(this.key(roomId), JSON.stringify(next))
      await this.copyRoomTtl(roomId)
      return next
    })
  }

  async remove(roomId: string): Promise<boolean> {
    return (await this.redis.del(this.key(roomId))) > 0
  }

  private key(roomId: string): string {
    return this.options.stateKey(roomId)
  }

  /**
   * 게임 상태는 방보다 오래 살아서는 안 된다 — 방 키의 남은 TTL을 그대로 복사한다
   * (방 활동으로 TTL이 밀리면 다음 갱신에서 다시 따라간다).
   */
  private async copyRoomTtl(roomId: string): Promise<void> {
    const ttl = await this.redis.pttl(roomKey(roomId))
    if (ttl > 0) await this.redis.pexpire(this.key(roomId), ttl)
  }

  private async withLock<T>(roomId: string, action: () => Promise<T>): Promise<T> {
    const lockKey = `${this.key(roomId)}:lock`
    const token = randomUUID()
    const deadline = Date.now() + this.options.lockWaitMillis
    while (
      (await this.redis.set(lockKey, token, 'PX', this.options.lockTtlMillis, 'NX')) !== 'OK'
    ) {
      if (Date.now() >= deadline) throw new ConflictError('game_state_busy')
      await sleep(this.options.lockRetryMillis)
    }
    try {
      return await action()
    } finally {
      await runLua(this.redis, this.unlock, [lockKey], [token]).catch(() => 0)
    }
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
