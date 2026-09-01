import type { Redis } from 'ioredis'
import { ConflictError } from '../../errors.js'
import { gameStateKey } from '../../room/keys.js'
import { RedisVersionedStateStore } from '../versionedStateStore.js'
import { DAVINCI_CODE } from './davinciCode.js'
import type { DavinciState } from './davinciState.js'

/**
 * 진행 중 다빈치 코드 상태의 저장소.
 *
 * 락 전략과 version 판정은 세 게임이 같아 `game/versionedStateStore.ts`에 있다.
 * 여기 남는 것은 **이 게임만의 것**뿐이다: 상태 키, 저장된 값이 다빈치 상태인지 보는
 * 검증, 그리고 오류 코드 문자열.
 */
export interface DavinciStateStore {
  /** 첫 초기화만 허용한다(SETNX). 이미 있으면 `davinci_already_initialized`. */
  initialize(roomId: string, state: DavinciState): Promise<void>

  find(roomId: string): Promise<DavinciState | null>

  /**
   * 락 안에서 read → 규칙 적용 → write.
   *
   * @param mutation `null`을 돌려주면 "변이 없음". 규칙 함수가 상태를 그대로 돌려준
   *   경우(= version 비증가)도 같게 취급한다.
   * @returns 실제로 저장된 새 상태. 변이가 없었으면 `null`(방송·재예약 금지 신호).
   */
  mutate(
    roomId: string,
    mutation: (current: DavinciState) => DavinciState | null,
  ): Promise<DavinciState | null>

  remove(roomId: string): Promise<boolean>
}

const stateKey = (roomId: string): string => {
  if (roomId.trim().length === 0) throw new Error('roomId must not be blank')
  return gameStateKey(roomId, DAVINCI_CODE)
}

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
