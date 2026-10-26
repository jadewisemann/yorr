import { ConflictError } from '../../errors.js'
import type { RoundState } from '../round/index.js'
import { deserializeState, serializeState } from './yachtDiceStateSnapshot.js'

/**
 * 야추 상태 스냅샷의 **직렬화 경계** — 손상된 스냅샷을 도메인 오류로 바꾼다.
 *
 * 스토어에서 갈라 둔 이유: 이 변환은 Redis도 락도 모른다. "손상 → 어떤 오류인가"와
 * "상태를 어떻게 저장하는가"를 분리해 두면 직렬화 형식을 바꿀 때 락 코드를 지나치지
 * 않는다.
 */

export const serializeStateOrFail = (state: RoundState): string => {
  try {
    return serializeState(state)
  } catch (error) {
    throw invalidYachtState(error)
  }
}

export const deserializeStateOrFail = (value: string): RoundState => {
  try {
    return deserializeState(value)
  } catch (error) {
    throw invalidYachtState(error)
  }
}

/**
 * 스냅샷이 손상됐을 때의 오류(`invalid_yacht_state`).
 *
 * `CodedError`의 생성자는 코드 문자열만 받으므로(오류 계약이 그 문자열이다) 원인은
 * 표준 `Error.cause`에 따로 붙인다 — 손상된 스냅샷을 진단할 때 이것만이 단서다.
 */
export const invalidYachtState = (cause: unknown): ConflictError => {
  const failure = new ConflictError('invalid_yacht_state')
  failure.cause = cause
  return failure
}
