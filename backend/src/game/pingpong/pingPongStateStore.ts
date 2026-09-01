import type { Redis } from 'ioredis'
import { ConflictError } from '../../errors.js'
import { gameStateKey } from '../../room/keys.js'
import { PING_PONG } from '../catalog.js'
import { RedisVersionedStateStore } from '../versionedStateStore.js'
import type { PingPongStateStore } from './pingPongPorts.js'
import type { PingPongState } from './pingPongState.js'

/**
 * Redis 어댑터.
 *
 * 상태 하나가 JSON 문자열로 `room:{code}:game:PING_PONG:state`에 산다. 락 전략과
 * version 판정은 세 게임이 같아 `game/versionedStateStore.ts`에 있고, 여기 남는 것은
 * 탁구만의 것이다: 저장 전후의 정규화, 그리고 **없음을 `undefined`로 돌려주는 계약**
 * (다빈치·결투는 `null`이다).
 *
 * 락이 필요한 이유: 스윙과 마감 타임아웃이 같은 방의 같은 상태를 동시에 읽고 쓴다.
 * Node가 단일 스레드라도 `await` 사이에 다른 요청이 끼어들 수 있어 read → mutate →
 * write를 직렬화해야 "같은 공을 두 번 리턴"이 막힌다.
 */

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

const stateKey = (roomId: string): string => {
  if (roomId.trim().length === 0) throw new Error('roomId must not be blank')
  return gameStateKey(roomId, PING_PONG)
}

const deserialize = (value: string): PingPongState => {
  try {
    return normalize(JSON.parse(value) as PingPongState)
  } catch {
    throw new ConflictError('invalid_ping_pong_state')
  }
}

export class RedisPingPongStateStore implements PingPongStateStore {
  private readonly store: RedisVersionedStateStore<PingPongState>

  constructor(redis: Redis) {
    this.store = new RedisVersionedStateStore(redis, {
      stateKey,
      parse: deserialize,
      alreadyInitializedCode: 'ping_pong_already_initialized',
      unlockScriptName: 'pingPongUnlock',
      lockTtlMillis: 5_000,
      lockWaitMillis: 2_000,
      lockRetryMillis: 10,
    })
  }

  async initialize(roomId: string, state: PingPongState): Promise<void> {
    await this.store.initialize(roomId, state)
  }

  async find(roomId: string): Promise<PingPongState | undefined> {
    return (await this.store.find(roomId)) ?? undefined
  }

  async mutate(
    roomId: string,
    mutation: (current: PingPongState) => PingPongState | null,
  ): Promise<PingPongState | undefined> {
    return (await this.store.mutate(roomId, mutation)) ?? undefined
  }

  async remove(roomId: string): Promise<boolean> {
    return this.store.remove(roomId)
  }
}
