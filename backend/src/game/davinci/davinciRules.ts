import { DomainError } from '../../errors.js'
import {
  DAVINCI_JOKER,
  type DavinciEvent,
  type DavinciPlayerNumbers,
  type DavinciState,
  type DavinciTile,
  type DavinciTileColor,
} from './davinciState.js'

/**
 * 다빈치 코드 규칙 — **순수 함수라 네트워크·Redis·연출을 전혀 모른다**
 * (DESIGN.md 「코드 구조」의 도메인/전송 분리, 결투 `duelRules.ts`와 같은 자리).
 *
 * 한 턴 = 더미에서 한 장 뽑고(감춘 채) → 상대 타일 하나를 지목해 숫자를 맞힌다 →
 * 맞히면 그 타일이 공개되고 **계속 맞힐지 멈출지** 고른다 → 틀리면 방금 뽑은 타일을
 * 공개하며 손에 넣고 턴이 넘어간다. 자기 타일이 전부 공개되면 탈락하고, 감춘 타일이
 * 남은 사람이 하나뿐이면 그 사람이 이긴다.
 *
 * 타일은 손에서 **왼쪽부터 오름차순**이고 같은 숫자면 검정이 왼쪽이다. 이 정렬이
 * 게임의 유일한 공개 단서라 삽입 위치는 규칙이 정한다 — 사람이 고르는 것은 조커의
 * 자리뿐이다(조커는 어떤 숫자로도 볼 수 있어 정렬이 강제되지 않는다).
 *
 * ## 정식 규칙에서 손본 세 가지
 *
 * 1. **처음 나눠 주는 패에는 조커가 없다.** 정식으로는 시작 패의 조커도 본인이
 *    놓을 자리를 고르지만, 그러려면 판이 시작하자마자 사람 수만큼의 배치 단계를
 *    거쳐야 한다. 조커를 더미에 남겨 두면 시작 패는 정렬만으로 결정되고, 조커의
 *    자리 선택은 게임 중에 뽑았을 때 그대로 살아 있다.
 * 2. **더미가 비었을 때 틀리면 가장 왼쪽 비공개 타일이 공개된다.** 정식으로는 공개할
 *    타일을 본인이 고른다. 고르게 하려면 이 경우에만 쓰는 단계가 하나 더 필요한데,
 *    26장 중 8~12장만 나눠 주므로 실제로 닿기 드문 경로다.
 * 3. **제한 시간이 있다.** 정식 규칙에 없지만 실시간 방에서는 한 사람이 멈추면 판이
 *    통째로 멈춘다. 추측을 넘기면 틀린 것과 같게 처리된다.
 */

/** 색깔마다 0~11 열두 장 + 조커 한 장 = 스물여섯 장. */
export const DAVINCI_MAX_NUMBER = 11
export const DAVINCI_DECK_SIZE = 26

export const DAVINCI_MIN_PLAYERS = 2
export const DAVINCI_MAX_PLAYERS = 4

/** 4인이면 세 장, 2~3인이면 네 장 — 정식 규칙 그대로다. */
const HAND_SIZE_FEW = 4
const HAND_SIZE_MANY = 3
const MANY_PLAYERS = 4

/** 각 단계의 제한 시간(ms). 추측이 가장 길다 — 유일하게 생각할 것이 있는 단계다. */
export const GUESS_MILLIS = 30_000
export const DECIDE_MILLIS = 15_000
export const PLACE_MILLIS = 15_000

/** 섞기 전의 표준 스물여섯 장. 이 순서 자체는 판에 쓰이지 않는다(항상 섞어서 쓴다). */
export const DAVINCI_TILES: readonly { color: DavinciTileColor; number: number }[] = [
  ...(['BLACK', 'WHITE'] as const).flatMap((color) => [
    ...Array.from({ length: DAVINCI_MAX_NUMBER + 1 }, (_, number) => ({ color, number })),
    { color, number: DAVINCI_JOKER },
  ]),
]

const at = (values: DavinciPlayerNumbers, playerId: string, fallback: number): number =>
  values[playerId] ?? fallback

const handOf = (state: DavinciState, playerId: string): readonly DavinciTile[] =>
  // Stryker disable next-line ArrayDeclaration: 빈 배열을 다른 배열로 바꿔도 결과가 같다.
  // 손패가 빠진 사람은 어느 갈래로 가든 "감춘 타일이 없다"로 읽히기 때문이다.
  state.hands[playerId] ?? []

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

const insertAt = (
  hand: readonly DavinciTile[],
  tile: DavinciTile,
  index: number,
): DavinciTile[] => [...hand.slice(0, index), tile, ...hand.slice(index)]

export const isGuessableNumber = (value: number): boolean =>
  value === DAVINCI_JOKER || (Number.isInteger(value) && value >= 0 && value <= DAVINCI_MAX_NUMBER)

const hiddenTiles = (hand: readonly DavinciTile[]): DavinciTile[] =>
  hand.filter((tile) => !tile.revealed)

const survivors = (
  playerOrder: readonly string[],
  eliminated: readonly string[],
): readonly string[] => playerOrder.filter((playerId) => !eliminated.includes(playerId))

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
  const [turnPlayerId] = players
  if (
    players.length < DAVINCI_MIN_PLAYERS ||
    players.length > DAVINCI_MAX_PLAYERS ||
    // Stryker disable next-line ConditionalExpression: 사람 수가 범위 안이면 첫 자리는
    // 반드시 있다. 이 검사는 타입을 좁히기 위한 것이고 앞의 두 조건이 실제 갈래다.
    turnPlayerId === undefined
  ) {
    throw new DomainError('davinci_requires_two_to_four_players')
  }
  if (new Set(players).size !== players.length) throw new DomainError('davinci_duplicate_player')
  // Stryker disable next-line ConditionalExpression: 길이가 모자라면 서로 다른 값의 개수도
  // 모자라므로 뒤의 조건이 같은 것을 잡는다. 두 검사가 함께 "26개의 서로 다른 값"을 뜻한다.
  if (order.length !== DAVINCI_DECK_SIZE || new Set(order).size !== DAVINCI_DECK_SIZE) {
    throw new DomainError('davinci_invalid_deck_order')
  }

  const shuffled: DavinciTile[] = order.map((tileIndex, position) => {
    const tile = DAVINCI_TILES[tileIndex]
    if (tile === undefined) throw new DomainError('davinci_invalid_deck_order')
    return { id: `T${position}`, color: tile.color, number: tile.number, revealed: false }
  })

  // 시작 패에는 조커를 넣지 않는다(위 「손본 세 가지」 1). 남은 조커는 더미에 그대로 있다.
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

/** 다음 턴으로 넘긴다 — 탈락 정리·승부 확인·다음 사람 뽑기까지 한 곳에서 한다. */
const advance = (state: DavinciState, now: number): DavinciState => {
  const current = state.turnPlayerId
  const wiped = hiddenTiles(handOf(state, current)).length === 0
  const eliminated =
    wiped && !state.eliminated.includes(current) ? [...state.eliminated, current] : state.eliminated

  const alive = survivors(state.playerOrder, eliminated)
  if (alive.length <= 1) {
    return { ...state, phase: 'FINISHED', eliminated, winnerId: alive[0] ?? null, nextActionAt: 0 }
  }

  // 자리 순서를 돌며 탈락자를 건너뛴다. 떠난 사람도 playerOrder에는 남아 있다.
  const seat = state.playerOrder.indexOf(current)
  let next = current
  // Stryker disable next-line EqualityOperator: 한 바퀴를 다 돌아 자기 자신으로 돌아오는
  // 경우는 살아남은 사람이 하나뿐이라는 뜻인데, 그것은 바로 위에서 이미 걸렸다.
  for (let step = 1; step <= state.playerOrder.length; step += 1) {
    const candidate = state.playerOrder[(seat + step) % state.playerOrder.length]
    // Stryker disable next-line ConditionalExpression: 자리 배열에는 빈 칸이 없다.
    // 이 검사는 인덱스 접근의 타입을 좁히기 위한 것이고 뒤의 생존 확인이 실제 갈래다.
    if (candidate !== undefined && alive.includes(candidate)) {
      next = candidate
      break
    }
  }

  const [drawn, ...rest] = state.deck
  return {
    ...state,
    phase: 'GUESSING',
    turnPlayerId: next,
    eliminated,
    deck: rest,
    drawn: drawn ?? null,
    turn: state.turn + 1,
    nextActionAt: now + GUESS_MILLIS,
  }
}

/**
 * 턴을 끝내며 들고 있던 타일을 손에 넣는다.
 *
 * @param reveal 공개하며 넣는가(틀렸거나 시간을 넘긴 경우) 감춘 채 넣는가(맞히고 멈춘 경우).
 *
 * 조커는 자리를 사람이 고르므로 여기서 끝내지 않고 `PLACING`으로 넘어간다 —
 * 공개된 조커도 마찬가지다. 놓인 자리가 다음 추론의 재료라 공개 여부와 상관없이
 * 본인이 정해야 한다.
 */
const concludeTurn = (state: DavinciState, reveal: boolean, now: number): DavinciState => {
  const playerId = state.turnPlayerId
  const drawn = state.drawn

  if (drawn === null) {
    // 더미가 비어 뽑지 못한 턴 — 틀렸으면 자기 타일을 대신 공개한다(위 「손본 세 가지」 2).
    if (!reveal) return advance(state, now)
    const hand = handOf(state, playerId)
    const target = hand.find((tile) => !tile.revealed)
    if (target === undefined) return advance(state, now)
    const hands = {
      ...state.hands,
      [playerId]: hand.map((tile) => (tile.id === target.id ? { ...tile, revealed: true } : tile)),
    }
    return advance({ ...state, hands }, now)
  }

  const tile: DavinciTile = reveal ? { ...drawn, revealed: true } : drawn
  if (tile.number === DAVINCI_JOKER) {
    return { ...state, phase: 'PLACING', drawn: tile, nextActionAt: now + PLACE_MILLIS }
  }

  const hand = handOf(state, playerId)
  const hands = { ...state.hands, [playerId]: insertAt(hand, tile, insertIndexOf(hand, tile)) }
  return advance({ ...state, hands, drawn: null }, now)
}

const guessEvent = (
  state: DavinciState,
  targetId: string,
  tileId: string,
  number: number,
  correct: boolean,
  now: number,
): DavinciEvent => ({
  kind: 'GUESS',
  actorId: state.turnPlayerId,
  targetId,
  tileId,
  number,
  correct,
  at: now,
})

/**
 * 상대 타일 하나의 숫자를 부른다.
 *
 * 무시하는 입력(내 차례가 아님·이미 처리한 inputSeq·공개된 타일·탈락자 지목)은
 * **상태를 그대로 돌려준다** — 스토어가 version 비증가를 보고 방송도 재예약도 하지
 * 않는다(결투 `draw`와 같은 관용).
 */
export const guess = (
  state: DavinciState,
  playerId: string,
  inputSeq: number,
  targetId: string,
  tileId: string,
  number: number,
  now: number,
): DavinciState => {
  if (state.phase !== 'GUESSING' || state.turnPlayerId !== playerId) return state
  if (inputSeq <= at(state.lastInputSeq, playerId, -1)) return state
  if (targetId === playerId || !state.playerOrder.includes(targetId)) return state
  if (state.eliminated.includes(targetId)) return state
  if (!isGuessableNumber(number)) return state

  const targetHand = handOf(state, targetId)
  const tile = targetHand.find((candidate) => candidate.id === tileId)
  if (tile === undefined || tile.revealed) return state

  const seq = { ...state.lastInputSeq, [playerId]: inputSeq }
  const correct = tile.number === number
  const event = guessEvent(state, targetId, tileId, number, correct, now)

  if (!correct) {
    return {
      ...concludeTurn({ ...state, lastInputSeq: seq }, true, now),
      version: state.version + 1,
      lastEvent: event,
    }
  }

  const hands = {
    ...state.hands,
    [targetId]: targetHand.map((candidate) =>
      candidate.id === tileId ? { ...candidate, revealed: true } : candidate,
    ),
  }
  const eliminated =
    // Stryker disable next-line ArrayDeclaration: 바로 위에서 `hands[targetId]`를 만들었다.
    // 이 자리에 닿을 때 그 값은 언제나 있으므로 대체 배열이 쓰이지 않는다.
    hiddenTiles(hands[targetId] ?? []).length === 0
      ? [...state.eliminated, targetId]
      : state.eliminated
  const hit = { ...state.hits, [playerId]: at(state.hits, playerId, 0) + 1 }
  const alive = survivors(state.playerOrder, eliminated)

  const base: DavinciState = {
    ...state,
    version: state.version + 1,
    hands,
    eliminated,
    hits: hit,
    lastInputSeq: seq,
    lastEvent: event,
  }
  if (alive.length <= 1) {
    return { ...base, phase: 'FINISHED', winnerId: alive[0] ?? playerId, nextActionAt: 0 }
  }
  return { ...base, phase: 'DECIDING', nextActionAt: now + DECIDE_MILLIS }
}

export type DavinciDecision = 'CONTINUE' | 'STOP'

/** 맞힌 뒤의 선택 — 한 번 더 부를지, 뽑은 타일을 감춘 채 넣고 턴을 넘길지. */
export const decide = (
  state: DavinciState,
  playerId: string,
  inputSeq: number,
  decision: DavinciDecision,
  now: number,
): DavinciState => {
  if (state.phase !== 'DECIDING' || state.turnPlayerId !== playerId) return state
  if (inputSeq <= at(state.lastInputSeq, playerId, -1)) return state

  const seq = { ...state.lastInputSeq, [playerId]: inputSeq }
  if (decision === 'CONTINUE') {
    return {
      ...state,
      version: state.version + 1,
      phase: 'GUESSING',
      lastInputSeq: seq,
      nextActionAt: now + GUESS_MILLIS,
    }
  }
  return {
    ...concludeTurn({ ...state, lastInputSeq: seq }, false, now),
    version: state.version + 1,
  }
}

/** 들고 있던 조커를 `index` 자리에 넣고 턴을 넘긴다. 자리 검증까지 여기서 한다. */
const placeDrawn = (state: DavinciState, index: number, now: number): DavinciState => {
  const drawn = state.drawn
  if (drawn === null) return state
  const hand = handOf(state, state.turnPlayerId)
  if (!Number.isInteger(index) || index < 0 || index > hand.length) return state
  const hands = { ...state.hands, [state.turnPlayerId]: insertAt(hand, drawn, index) }
  return advance({ ...state, hands, drawn: null }, now)
}

/** 조커를 놓는다. `index`는 삽입 자리(0부터 손패 길이까지). */
export const place = (
  state: DavinciState,
  playerId: string,
  inputSeq: number,
  index: number,
  now: number,
): DavinciState => {
  if (state.phase !== 'PLACING' || state.turnPlayerId !== playerId) return state
  if (inputSeq <= at(state.lastInputSeq, playerId, -1)) return state

  const seq = { ...state.lastInputSeq, [playerId]: inputSeq }
  const next = placeDrawn({ ...state, lastInputSeq: seq }, index, now)
  if (next.phase === 'PLACING') return state
  return { ...next, version: state.version + 1 }
}

/**
 * 마감이 지났을 때의 다음 상태. **어느 갈래로 가든 턴은 반드시 움직인다.**
 *
 * 움직이지 않으면 `nextActionAt`이 그대로 남고, 이미 지난 마감으로 예약이 다시 걸려
 * 즉시 발화한다 — 제자리를 도는 무한 루프가 된다. 그래서 조커를 놓지 못한 경우
 * (`PLACING`인데 들고 있는 타일이 없는, 있어서는 안 되는 상태)에도 턴을 넘긴다.
 */
const timedOut = (state: DavinciState, now: number): DavinciState => {
  if (state.phase !== 'PLACING') return concludeTurn(state, state.phase === 'GUESSING', now)
  // 고르지 않았으면 가장 오른쪽에 놓는다 — 그 자리는 조커를 최댓값으로 보이게 하므로,
  // 시간을 흘려서 얻는 이득이 없다.
  const placed = placeDrawn(state, handOf(state, state.turnPlayerId).length, now)
  return placed.phase === 'PLACING' ? advance({ ...state, drawn: null }, now) : placed
}

/**
 * 제한 시간이 지났다. 넘긴 추측은 **틀린 것과 같게** 처리한다 — 그렇지 않으면 아무
 * 손해 없이 시간을 흘려 상대의 정보만 쌓게 할 수 있다.
 */
export const expire = (state: DavinciState, now: number): DavinciState => {
  if (state.phase === 'FINISHED') return state
  const event: DavinciEvent = {
    kind: 'TIMEOUT',
    actorId: state.turnPlayerId,
    targetId: null,
    tileId: null,
    number: null,
    correct: false,
    at: now,
  }
  return { ...timedOut(state, now), version: state.version + 1, lastEvent: event }
}

/**
 * 게임 중 이탈 — 손패를 전부 공개하고 탈락시킨다.
 *
 * 자리를 `playerOrder`에서 지우지 않는다: 남은 사람 화면에서 떠난 사람의 타일이
 * 사라지면 그때까지 맞힌 기록도 함께 사라져 판을 되짚을 수 없다.
 */
export const forfeit = (state: DavinciState, playerId: string, now: number): DavinciState => {
  if (state.phase === 'FINISHED') return state
  if (!state.playerOrder.includes(playerId) || state.eliminated.includes(playerId)) return state

  const hands = {
    ...state.hands,
    [playerId]: handOf(state, playerId).map((tile) => ({ ...tile, revealed: true })),
  }
  const eliminated = [...state.eliminated, playerId]
  const event: DavinciEvent = {
    kind: 'FORFEIT',
    actorId: playerId,
    targetId: null,
    tileId: null,
    number: null,
    correct: false,
    at: now,
  }
  const base: DavinciState = {
    ...state,
    version: state.version + 1,
    hands,
    eliminated,
    lastEvent: event,
  }

  const alive = survivors(state.playerOrder, eliminated)
  if (alive.length <= 1) {
    return { ...base, phase: 'FINISHED', winnerId: alive[0] ?? null, nextActionAt: 0 }
  }
  // 떠난 사람 차례였다면 판이 멈추므로 곧바로 다음 사람에게 넘긴다.
  if (state.turnPlayerId !== playerId) return base
  return { ...advance({ ...base, drawn: null }, now), version: state.version + 1 }
}
