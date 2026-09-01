import type { Redis } from 'ioredis'
import { ConflictError } from '../../errors.js'
import { type LuaScript, registerLuaScripts, runLuaNumber } from '../../infra/lua.js'
import { gameStateKey, roomKey } from '../../room/keys.js'
import { PING_PONG } from '../catalog.js'
import type { PingPongStateStore } from './pingPongPorts.js'
import type { PingPongState } from './pingPongState.js'

/**
 * Redis 어댑터.
 *
 * 상태 하나가 JSON 문자열로 `room:{code}:game:PING_PONG:state`에 산다. duel과
 * 같은 패턴이다: SETNX 초기화 · 방 단위 락(5초 TTL, 2초 스핀) · 방 키 PTTL 복사 ·
 * **version이 늘지 않는 변이는 쓰지 않는다.**
 *
 * 락이 필요한 이유: 스윙과 마감 타임아웃이 같은 방의 같은 상태를 동시에 읽고
 * 쓴다. Node가 단일 스레드라도 `await` 사이에 다른 요청이 끼어들 수 있어 read →
 * mutate → write를 직렬화해야 "같은 공을 두 번 리턴"이 막힌다.
 */

const LOCK_TTL_MILLIS = 5_000
const LOCK_WAIT_MILLIS = 2_000
const LOCK_SPIN_MILLIS = 10

/** 락 해제는 **내 토큰일 때만** — 만료된 뒤 남의 락을 지우지 않는다. */
const UNLOCK: LuaScript = {
  name: 'pingPongUnlock',
  numberOfKeys: 1,
  lua: `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`,
}

export const PING_PONG_STATE_SCRIPTS: readonly LuaScript[] = [UNLOCK]

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * JSON에서 되살린 상태를 정규화한다. **우리가 쓴 값만 들어온다**는 전제이지만,
 * `fault`·`serveReceiverId`·`lastEvent`는 생략될 수 있어(NON_NULL) null이 섞여
 * 들어오면 `undefined`로 맞춰 준다 — 그러지 않으면 다시 쓸 때 `"fault":null`이
 * 실려 와이어 계약이 조용히 달라진다.
 */
const normalize = (value: PingPongState): PingPongState => {
  const { fault, ...ball } = value.ball as PingPongState['ball'] & { fault?: unknown }
  return {
    ...value,
    ball: { ...ball, ...(fault == null ? {} : { fault: fault as PingPongState['ball']['fault'] }) },
    ...(value.serveReceiverId == null ? {} : { serveReceiverId: value.serveReceiverId }),
    ...(value.lastEvent == null ? {} : { lastEvent: value.lastEvent }),
  }
}

export class RedisPingPongStateStore implements PingPongStateStore {
  constructor(private readonly redis: Redis) {
    registerLuaScripts(redis, PING_PONG_STATE_SCRIPTS)
  }

  async initialize(roomId: string, state: PingPongState): Promise<void> {
    const created = await this.redis.set(stateKey(roomId), serialize(state), 'NX')
    if (created !== 'OK') throw new ConflictError('ping_pong_already_initialized')
    await this.copyRoomTtl(roomId)
  }

  async find(roomId: string): Promise<PingPongState | undefined> {
    const value = await this.redis.get(stateKey(roomId))
    return value === null ? undefined : deserialize(value)
  }

  async mutate(
    roomId: string,
    mutation: (current: PingPongState) => PingPongState | null,
  ): Promise<PingPongState | undefined> {
    return this.withLock(roomId, async () => {
      const key = stateKey(roomId)
      const value = await this.redis.get(key)
      if (value === null) return undefined
      const current = deserialize(value)
      const next = mutation(current)
      // 규칙 함수는 "무시"를 같은 상태 반환으로 표현한다 — 그 경우 쓰지 않는다.
      if (next === null || next.version === current.version) return undefined
      await this.redis.set(key, serialize(next))
      await this.copyRoomTtl(roomId)
      return next
    })
  }

  async remove(roomId: string): Promise<boolean> {
    return (await this.redis.del(stateKey(roomId))) > 0
  }

  private async withLock<T>(roomId: string, action: () => Promise<T>): Promise<T> {
    const lockKey = `${stateKey(roomId)}:lock`
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const deadline = Date.now() + LOCK_WAIT_MILLIS
    while ((await this.redis.set(lockKey, token, 'PX', LOCK_TTL_MILLIS, 'NX')) !== 'OK') {
      if (Date.now() >= deadline) throw new ConflictError('game_state_busy')
      await sleep(LOCK_SPIN_MILLIS)
    }
    try {
      return await action()
    } finally {
      await runLuaNumber(this.redis, UNLOCK, [lockKey], [token]).catch(() => 0)
    }
  }

  /**
   * 게임 상태는 방보다 오래 살아서는 안 된다 — 방 키의 남은 수명을 그대로 복사한다.
   * 방 키에 TTL이 없으면(테스트가 직접 심은 방) 그냥 둔다.
   */
  private async copyRoomTtl(roomId: string): Promise<void> {
    const ttl = await this.redis.pttl(roomKey(roomId))
    if (ttl > 0) await this.redis.pexpire(stateKey(roomId), ttl)
  }
}

const serialize = (state: PingPongState): string => JSON.stringify(state)

const deserialize = (value: string): PingPongState => {
  try {
    return normalize(JSON.parse(value) as PingPongState)
  } catch {
    throw new ConflictError('invalid_ping_pong_state')
  }
}

const stateKey = (roomId: string): string => {
  if (roomId.trim().length === 0) throw new Error('roomId must not be blank')
  return gameStateKey(roomId, PING_PONG)
}
