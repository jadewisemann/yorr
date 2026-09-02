import { DAVINCI_DECK_SIZE, initialDavinciState } from '../davinciRules.js'
import type { DavinciState, DavinciTile } from '../davinciState.js'

/** 다빈치 규칙 검사가 함께 쓰는 자리와 값. */
export const HOST = 'player-1'
export const GUEST = 'player-2'
export const THIRD = 'player-3'
export const NOW = 1_700_000_000_000

/** `DAVINCI_TILES`의 인덱스 — 0~11이 검정, 12가 검정 조커, 13~24가 흰색, 25가 흰색 조커다. */
export const BLACK = (number: number): number => number
export const WHITE = (number: number): number => 13 + number
export const BLACK_JOKER = 12

/** 앞에 놓고 싶은 타일만 지정하고 나머지는 남은 순서대로 채운 순열. */
export const deckOrder = (...front: readonly number[]): number[] => [
  ...front,
  ...Array.from({ length: DAVINCI_DECK_SIZE }, (_, index) => index).filter(
    (index) => !front.includes(index),
  ),
]

/** 2인 판: 앞 여덟 장이 손패(각 넷), 아홉 번째가 첫 턴에 뽑는 타일이다. */
export const twoPlayerState = (...front: readonly number[]): DavinciState =>
  initialDavinciState([HOST, GUEST], deckOrder(...front), NOW)

export const tilesOf = (state: DavinciState, playerId: string): readonly DavinciTile[] =>
  state.hands[playerId] ?? []

export const numbersOf = (state: DavinciState, playerId: string): number[] =>
  tilesOf(state, playerId).map((tile) => tile.number)
