import { DAVINCI_MAX_NUMBER } from './davinciConstants.js'
import { DAVINCI_JOKER, type DavinciTile, type DavinciTileColor } from './davinciState.js'

/**
 * 타일의 순서와 자리 — 다빈치 코드에서 **유일하게 공개되는 단서**를 다루는 규칙.
 *
 * 손은 왼쪽부터 숫자 오름차순이고 같은 숫자면 검정이 왼쪽이다. 이 정렬을 규칙이
 * 지배하므로, 사람이 고르는 것은 조커의 자리뿐이다. 정렬·삽입·비교를 한 파일에 모아
 * 두면 "왜 여기서 왼쪽으로 붙이는가"를 한 번만 읽으면 된다.
 */

/** 정렬 순서 — 숫자 오름차순, 같으면 검정이 먼저. 조커는 이 비교에 들어오지 않는다. */
export const compareTiles = (
  left: { color: DavinciTileColor; number: number },
  right: { color: DavinciTileColor; number: number },
): number => {
  if (left.number !== right.number) return left.number - right.number
  if (left.color === right.color) return 0
  return left.color === 'BLACK' ? -1 : 1
}

/**
 * 새 타일이 들어갈 자리 — **규칙이 허용하는 가장 왼쪽**이다.
 *
 * 조커는 어떤 숫자로도 통하므로 비교에서 건너뛴다. 그래서 조커 옆은 자리가 두 곳
 * 이상 열리는데, 그때마다 사람에게 묻지 않고 왼쪽으로 붙인다 — 조커가 오른쪽으로
 * 밀려도 조커의 자리는 그대로 보이므로, 이미 놓인 조커가 흘리는 정보는 늘지 않는다.
 */
export const insertIndexOf = (
  hand: readonly DavinciTile[],
  tile: { color: DavinciTileColor; number: number },
): number => {
  let index = 0
  for (const [position, other] of hand.entries()) {
    if (other.number === DAVINCI_JOKER) continue
    if (compareTiles(other, tile) <= 0) index = position + 1
  }
  return index
}

export const insertAt = (
  hand: readonly DavinciTile[],
  tile: DavinciTile,
  index: number,
): DavinciTile[] => [...hand.slice(0, index), tile, ...hand.slice(index)]

export const isGuessableNumber = (value: number): boolean =>
  value === DAVINCI_JOKER || (Number.isInteger(value) && value >= 0 && value <= DAVINCI_MAX_NUMBER)

export const hiddenTiles = (hand: readonly DavinciTile[]): DavinciTile[] =>
  hand.filter((tile) => !tile.revealed)
