import type { Redis } from 'ioredis'
import { ConflictError } from '../../errors.js'
import {
  gameStateKeyOf,
  RedisVersionedStateStore,
  type VersionedStateStore,
} from '../versionedStateStore.js'
import { DAVINCI_CODE } from './davinciCode.js'
import type { DavinciState } from './davinciState.js'

/**
 * 진행 중 다빈치 코드 상태의 저장소.
 *
 * 락 전략과 version 판정은 세 게임이 같아 `game/versionedStateStore.ts`에 있다.
 * 여기 남는 것은 **이 게임만의 것**뿐이다: 상태 키, 저장된 값이 다빈치 상태인지 보는
 * 검증, 그리고 오류 코드 문자열.
 */
export type DavinciStateStore = VersionedStateStore<DavinciState>

const stateKey = gameStateKeyOf(DAVINCI_CODE)

export class RedisDavinciStateStore
  extends RedisVersionedStateStore<DavinciState>
  implements DavinciStateStore
{
  constructor(redis: Redis) {
    super(redis, {
      stateKey,
      parse: deserialize,
      alreadyInitializedCode: 'davinci_already_initialized',
      unlockScriptName: 'davinciUnlock',
      lockTtlMillis: 5_000,
      lockWaitMillis: 2_000,
      lockRetryMillis: 10,
    })
  }
}

/**
 * 저장된 값이 다빈치 코드 상태가 아니면 조용히 넘기지 않는다. 배포 사이에 상태 모양이
 * 바뀌면 여기서 드러나는 편이 낫다 — 반쪽 상태로 판정하면 손패가 틀린 판이 계속된다.
 */
const deserialize = (value: string): DavinciState => {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new ConflictError('invalid_davinci_state')
  }
  if (!isDavinciState(parsed)) throw new ConflictError('invalid_davinci_state')
  return parsed
}

const isDavinciState = (value: unknown): value is DavinciState => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<DavinciState>
  return (
    typeof candidate.version === 'number' &&
    typeof candidate.phase === 'string' &&
    Array.isArray(candidate.playerOrder) &&
    Array.isArray(candidate.deck) &&
    typeof candidate.hands === 'object' &&
    candidate.hands !== null
  )
}
