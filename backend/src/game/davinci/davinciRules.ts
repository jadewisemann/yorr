import { DomainError } from '../../errors.js'
import {
  DAVINCI_DECK_SIZE,
  DAVINCI_MAX_PLAYERS,
  DAVINCI_MIN_PLAYERS,
  DAVINCI_TILES,
  DECIDE_MILLIS,
  GUESS_MILLIS,
  HAND_SIZE_FEW,
  HAND_SIZE_MANY,
  MANY_PLAYERS,
} from './davinciConstants.js'
import { at, handOf, survivors } from './davinciHelpers.js'
import {
  DAVINCI_JOKER,
  type DavinciEvent,
  type DavinciState,
  type DavinciTile,
} from './davinciState.js'
import { compareTiles, hiddenTiles, isGuessableNumber } from './davinciTiles.js'
import { advance, concludeTurn, placeDrawn, timedOut } from './davinciTurnFlow.js'

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

// 상수·타일 목록은 davinciConstants.ts가 정본이다. 기존 소비자가 이 파일에서
// 가져가므로 여기서 re-export한다.
export {
  DAVINCI_DECK_SIZE,
  DAVINCI_MAX_NUMBER,
  DAVINCI_MAX_PLAYERS,
  DAVINCI_MIN_PLAYERS,
  DAVINCI_TILES,
  DECIDE_MILLIS,
  GUESS_MILLIS,
  HAND_SIZE_FEW,
  HAND_SIZE_MANY,
  MANY_PLAYERS,
  PLACE_MILLIS,
} from './davinciConstants.js'

// 타일 순서·자리 규칙은 davinciTiles.ts가 정본이다. 기존 소비자(테스트·서비스)가
// 이 파일에서 가져가므로 여기서 re-export한다.
export {
  compareTiles,
  hiddenTiles,
  insertAt,
  insertIndexOf,
  isGuessableNumber,
} from './davinciTiles.js'

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
/** 추측 한 번의 입력 묶음 — 인자 일곱 개를 이름으로 읽기 위해 객체로 받는다. */
export interface GuessInput {
  readonly playerId: string
  readonly inputSeq: number
  readonly targetId: string
  readonly tileId: string
  readonly number: number
  readonly now: number
}

export const guess = (state: DavinciState, input: GuessInput): DavinciState => {
  const { playerId, inputSeq, targetId, tileId, number, now } = input
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
