import { GUESS_MILLIS, PLACE_MILLIS } from './davinciConstants.js'
import { handOf, survivors } from './davinciHelpers.js'
import { DAVINCI_JOKER, type DavinciState, type DavinciTile } from './davinciState.js'
import { hiddenTiles, insertAt, insertIndexOf } from './davinciTiles.js'

/**
 * 턴의 흐름 — 다음 사람 정하기, 들고 있던 타일 넣기, 시간 초과 처리.
 *
 * 왜 분리했나: `guess`·`decide`·`place`·`expire`는 모두 "이 턴을 어떻게 끝내는가"를
 * 이 함수들에 위임한다. 입력 판정과 턴 종결을 나눠 두면, 새 입력을 추가할 때 종결
 * 규칙을 건드릴 필요가 있는지 한눈에 보인다.
 */

/** 다음 턴으로 넘긴다 — 탈락 정리·승부 확인·다음 사람 뽑기까지 한 곳에서 한다. */
export const advance = (state: DavinciState, now: number): DavinciState => {
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
  for (let step = 1; step <= state.playerOrder.length; step += 1) {
    const candidate = state.playerOrder[(seat + step) % state.playerOrder.length]
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
export const concludeTurn = (state: DavinciState, reveal: boolean, now: number): DavinciState => {
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

/** 들고 있던 조커를 `index` 자리에 넣고 턴을 넘긴다. 자리 검증까지 여기서 한다. */
export const placeDrawn = (state: DavinciState, index: number, now: number): DavinciState => {
  const drawn = state.drawn
  if (drawn === null) return state
  const hand = handOf(state, state.turnPlayerId)
  if (!Number.isInteger(index) || index < 0 || index > hand.length) return state
  const hands = { ...state.hands, [state.turnPlayerId]: insertAt(hand, drawn, index) }
  return advance({ ...state, hands, drawn: null }, now)
}

/**
 * 마감이 지났을 때의 다음 상태. **어느 갈래로 가든 턴은 반드시 움직인다.**
 *
 * 움직이지 않으면 `nextActionAt`이 그대로 남고, 이미 지난 마감으로 예약이 다시 걸려
 * 즉시 발화한다 — 제자리를 도는 무한 루프가 된다. 그래서 조커를 놓지 못한 경우
 * (`PLACING`인데 들고 있는 타일이 없는, 있어서는 안 되는 상태)에도 턴을 넘긴다.
 */
export const timedOut = (state: DavinciState, now: number): DavinciState => {
  if (state.phase !== 'PLACING') return concludeTurn(state, state.phase === 'GUESSING', now)
  // 고르지 않았으면 가장 오른쪽에 놓는다 — 그 자리는 조커를 최댓값으로 보이게 하므로,
  // 시간을 흘려서 얻는 이득이 없다.
  const placed = placeDrawn(state, handOf(state, state.turnPlayerId).length, now)
  return placed.phase === 'PLACING' ? advance({ ...state, drawn: null }, now) : placed
}
