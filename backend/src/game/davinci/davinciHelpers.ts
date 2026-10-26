import type { DavinciPlayerNumbers, DavinciState, DavinciTile } from './davinciState.js'

/**
 * 다빈치 규칙이 공유하는 작은 조회 함수.
 *
 * 왜 분리했나: `at`·`handOf`·`survivors`는 상태 전이와 턴 흐름 양쪽이 쓰는데 어느
 * 쪽에도 속하지 않는다. 한 곳에 두면 두 모듈이 서로를 임포트하지 않는다.
 */

/** 좌석별 숫자 맵에서 값을 읽는다. 없으면 fallback. */
export const at = (values: DavinciPlayerNumbers, playerId: string, fallback: number): number =>
  values[playerId] ?? fallback

/** 손패. 아직 명단에 없는 사람은 빈 배열. */
export const handOf = (state: DavinciState, playerId: string): readonly DavinciTile[] =>
  state.hands[playerId] ?? []

/** 아직 탈락하지 않은 사람들 — `playerOrder` 순서를 유지한다. */
export const survivors = (
  playerOrder: readonly string[],
  eliminated: readonly string[],
): readonly string[] => playerOrder.filter((playerId) => !eliminated.includes(playerId))
