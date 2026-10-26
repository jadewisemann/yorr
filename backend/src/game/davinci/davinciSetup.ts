import { DomainError } from '../../errors.js'
import {
  DAVINCI_DECK_SIZE,
  DAVINCI_MAX_PLAYERS,
  DAVINCI_MIN_PLAYERS,
  DAVINCI_TILES,
  GUESS_MILLIS,
  HAND_SIZE_FEW,
  HAND_SIZE_MANY,
  MANY_PLAYERS,
} from './davinciConstants.js'
import { at, handOf } from './davinciHelpers.js'
import { DAVINCI_JOKER, type DavinciState, type DavinciTile } from './davinciState.js'
import { compareTiles, hiddenTiles } from './davinciTiles.js'

/**
 * 다빈치 코드의 **판 준비와 점수** — 시작 패를 나누는 순수 함수.
 *
 * 규칙 전이(`davinciRules.ts`)에서 갈라 둔 이유는 여기가 "판이 어떻게 깔리는가"만
 * 알기 때문이다. 전이는 추측·선택·배치의 입력을 해석하고, 이 파일은 섞인 더미를
 * 손패로 나눈 뒤 누가 무엇을 감췄는지로 점수를 낸다.
 */

/**
 * 판의 결과 점수 — **맞힌 타일 수 + 끝까지 감춰 낸 타일 수**.
 *
 * 이긴 사람만 감춘 타일이 남으므로 뒤쪽 순위는 맞힌 수로 갈린다. 감춘 수만 쓰면
 * 진 사람은 전부 0점이 되어 3~4인 판의 2위와 4위를 구분할 수 없다.
 */
export const scoreOf = (state: DavinciState, playerId: string): number =>
  at(state.hits, playerId, 0) + hiddenTiles(handOf(state, playerId)).length

/**
 * 첫 상태 — 섞은 순서(`order`)를 받아 나눠 준다.
 *
 * @param order `DAVINCI_TILES`의 인덱스를 섞은 순열. 난수는 호출자(서비스)가 주입한다 —
 *   규칙이 난수를 직접 만들면 테스트가 판을 고정할 수 없다.
 *
 * 타일 id는 **섞은 뒤의 자리 번호**(`T0`~)라 감춘 타일의 id에서 숫자를 되짚을 수 없다.
 */
export const initialDavinciState = (
  players: readonly string[],
  order: readonly number[],
  now: number,
): DavinciState => {
  if (players.length < DAVINCI_MIN_PLAYERS || players.length > DAVINCI_MAX_PLAYERS) {
    throw new DomainError('davinci_requires_two_to_four_players')
  }
  if (new Set(players).size !== players.length) throw new DomainError('davinci_duplicate_player')
  if (order.length !== DAVINCI_DECK_SIZE || new Set(order).size !== DAVINCI_DECK_SIZE) {
    throw new DomainError('davinci_invalid_deck_order')
  }

  const shuffled: DavinciTile[] = order.map((tileIndex, position) => {
    const tile = DAVINCI_TILES[tileIndex]
    if (tile === undefined) throw new DomainError('davinci_invalid_deck_order')
    return { id: `T${position}`, color: tile.color, number: tile.number, revealed: false }
  })

  // 시작 패에는 조커를 넣지 않는다(davinciRules.ts 「손본 세 가지」 1). 남은 조커는
  // 더미에 그대로 있다.
  const handSize = players.length >= MANY_PLAYERS ? HAND_SIZE_MANY : HAND_SIZE_FEW
  const dealable = shuffled.filter((tile) => tile.number !== DAVINCI_JOKER)
  const dealt = dealable.slice(0, players.length * handSize)
  const dealtIds = new Set(dealt.map((tile) => tile.id))

  const hands: Record<string, DavinciTile[]> = {}
  const hits: Record<string, number> = {}
  const lastInputSeq: Record<string, number> = {}
  for (const [seat, playerId] of players.entries()) {
    hands[playerId] = dealt
      .slice(seat * handSize, (seat + 1) * handSize)
      .sort((left, right) => compareTiles(left, right))
    hits[playerId] = 0
    lastInputSeq[playerId] = -1
  }

  const deck = shuffled.filter((tile) => !dealtIds.has(tile.id))
  const [turnPlayerId] = players
  if (turnPlayerId === undefined) throw new DomainError('davinci_requires_two_to_four_players')
  const [drawn, ...rest] = deck

  return {
    version: 1,
    phase: 'GUESSING',
    playerOrder: [...players],
    turnPlayerId,
    hands,
    deck: rest,
    drawn: drawn ?? null,
    turn: 1,
    eliminated: [],
    winnerId: null,
    hits,
    lastInputSeq,
    nextActionAt: now + GUESS_MILLIS,
  }
}
