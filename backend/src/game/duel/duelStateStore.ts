import type { Redis } from 'ioredis'
import { ConflictError } from '../../errors.js'
import {
  gameStateKeyOf,
  RedisVersionedStateStore,
  type VersionedStateStore,
} from '../versionedStateStore.js'
import { DUEL_CODE } from './duelCode.js'
import type { DuelState } from './duelState.js'

/**
 * 진행 중 결투 상태의 저장소.
 *
 * 락 전략과 version 판정은 세 게임이 같아 `game/versionedStateStore.ts`에 있다.
 * 여기 남는 것은 상태 키·검증·오류 코드처럼 **이 게임만의 것**뿐이다.
 */
export type DuelStateStore = VersionedStateStore<DuelState>

const stateKey = gameStateKeyOf(DUEL_CODE)

export class RedisDuelStateStore
  extends RedisVersionedStateStore<DuelState>
  implements DuelStateStore
{
  constructor(redis: Redis) {
    super(redis, {
      stateKey,
      parse: deserialize,
      alreadyInitializedCode: 'duel_already_initialized',
      unlockScriptName: 'duelUnlock',
      lockTtlMillis: 5_000,
      lockWaitMillis: 2_000,
      lockRetryMillis: 10,
    })
  }
}

/**
 * 저장된 값이 결투 상태가 아니면 **조용히 넘기지 않는다**.
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
