import { DomainError } from '../../errors.js'
import { FOUL, MAX_HP, MISS, resolveRound } from './duelRound.js'
import type { DuelPlayerNumbers, DuelState } from './duelState.js'

/**
 * 석양이 진다 — 결투의 **상태 전이**. 순수 함수라
 * 네트워크·Redis·연출을 전혀 모른다(DESIGN.md 「코드 구조」의 도메인/전송 분리).
 *
 * 한 라운드 = 신호등 빨강 → (랜덤 대기) → 초록 → 더 빨리 뽑은 쪽이 쏜다 →
 * 상대 체력 -1 → 체력이 0이 되면 쓰러진다(패배).
 *
 * 반응은 ms 정수로 비교하고, 1ms까지 같으면 TIE(체력 변화 없이 다음 라운드)다.
 * **모인 반응을 해석하는 판정은 `duelRound.ts`가 맡는다** — 이 파일은 언제 신호를
 * 켜고 언제 라운드를 넘기는지만 안다.
 *
 * **부정출발 — 매치 통산 2번이면 패배**: 신호 전에 뽑으면 1회차는 라운드 무효(상대
 * 무피해)이고 경고만 쌓인다. 경고는 라운드마다 초기화되지 않고 **매치 내내 누적**되며,
 * `MAX_FOULS`개가 차는 순간 남은 총알과 무관하게 그 자리에서 결투를 잃는다.
 * 1회차를 무료로 두는 이유는 탭·폰 흔들기 입력이 손떨림으로 오작동하기 쉬워서다.
 * 반대로 계속 무료면 긴장이 사라지므로 두 번째는 곧바로 승부를 끝낸다. (신호 전에는
 * 아무 정보도 없어 "불리한 라운드를 파울로 회피"하는 악용은 불가능하다.)
 */

// 판정·센티넬·연출 시간은 duelRound.ts가 정본이다. 기존 소비자(배럴·테스트)가 이
// 파일에서 가져가므로 여기서 re-export한다.
export {
  compareDraw,
  FOUL,
  hold,
  KO_HOLD_MILLIS,
  MAX_FOULS,
  MAX_HP,
  MISS,
  RESULT_HOLD_MILLIS,
  TIE_HOLD_MILLIS,
} from './duelRound.js'

/** 신호(초록)까지의 랜덤 대기 — 예측 못 하게 넉넉한 폭. 매 라운드 재추첨한다. */
export const MIN_WAIT_MILLIS = 1_400
export const MAX_WAIT_MILLIS = 4_600
/** 한쪽이 먼저 뽑은 뒤, 상대가 뽑을 수 있는 마지막 유예. */
export const GRACE_MILLIS = 700
/** 신호 후 아무도 안 뽑으면 라운드를 무효로 넘긴다. */
export const FREEZE_MILLIS = 2_600

const copy = (values: DuelPlayerNumbers): Record<string, number> => ({ ...values })

const at = (values: DuelPlayerNumbers, playerId: string, fallback: number): number =>
  values[playerId] ?? fallback

/** playerOrder는 항상 2명이다 — 그 불변식을 여기서 한 번만 꺼내 쓴다. */
const sides = (state: DuelState): readonly [string, string] => {
  const [first, second] = state.playerOrder
  if (first === undefined || second === undefined) {
    throw new DomainError('duel_requires_two_players')
  }
  return [first, second]
}

export const initialDuelState = (
  players: readonly string[],
  now: number,
  wait: number,
): DuelState => {
  if (players.length !== 2) throw new DomainError('duel_requires_two_players')
  const hp: Record<string, number> = {}
  const fouls: Record<string, number> = {}
  const lastInputSeq: Record<string, number> = {}
  for (const player of players) {
    hp[player] = MAX_HP
    fouls[player] = 0
    lastInputSeq[player] = -1
  }
  return {
    version: 1,
    phase: 'WAITING',
    playerOrder: [...players],
    hp,
    fouls,
    reactions: {},
    lastInputSeq,
    round: 1,
    signalAt: 0,
    nextActionAt: now + wait,
  }
}

/** 신호등을 초록으로. 이후 {@link FREEZE_MILLIS}까지 아무도 안 뽑으면 라운드가 무효다. */
export const signal = (state: DuelState, now: number): DuelState => {
  if (state.phase !== 'WAITING') return state
  return {
    ...state,
    version: state.version + 1,
    phase: 'SIGNAL',
    signalAt: now,
    nextActionAt: now + FREEZE_MILLIS,
    lastRound: undefined,
  }
}

/**
 * 한 진영이 총을 뽑았다.
 *
 * 반응 시간은 **클라이언트가 측정한 값**을 쓴다. 서버 도착 시각으로 재면 왕복 지연이
 * 그대로 핸디캡이 되어 반응 게임의 공정성이 무너진다. 대신 서버가 흐른 시간을 상한으로
 * 잡아 "신호보다 늦게 도착했는데 더 빠른 기록"은 깎는다. 더 빠르게 신고하는 조작까지는
 * 막지 못하는데, 친구끼리 하는 파티 게임이라 지연 공정성을 택했다.
 */
/** 뽑기 한 번의 입력 묶음 — 이름으로 읽기 위해 객체로 받는다. */
export interface DrawInput {
  readonly playerId: string
  readonly inputSeq: number
  /** 클라이언트가 신호를 본 순간부터 잰 값. 음수면 신호 전에 뽑았다는 신고다. */
  readonly reportedMs: number
  readonly now: number
}

export const draw = (state: DuelState, input: DrawInput): DuelState => {
  const { playerId, inputSeq, reportedMs, now } = input
  if (!state.playerOrder.includes(playerId)) return state
  if (inputSeq <= at(state.lastInputSeq, playerId, -1)) return state

  const lastInputSeq = copy(state.lastInputSeq)
  lastInputSeq[playerId] = inputSeq

  const live = state.phase === 'WAITING' || state.phase === 'SIGNAL'
  // 판정에는 영향이 없지만 입력 번호는 남겨야 한다 — 그래야 같은 입력이 재전송돼도
  // 다음 라운드에서 되살아나지 않는다.
  if (!live || state.reactions[playerId] !== undefined) {
    return { ...state, version: state.version + 1, lastInputSeq }
  }

  const reactions = copy(state.reactions)
  // 신호가 아직 빨강이면 payload가 뭐라 하든 부정출발이다 — 판정 권한은 서버에 있다.
  const elapsed = Math.max(0, now - state.signalAt)
  reactions[playerId] =
    state.phase === 'WAITING' || reportedMs < 0
      ? FOUL
      : Math.max(0, Math.min(Math.trunc(reportedMs), elapsed))

  if (reactions[playerId] === FOUL || Object.keys(reactions).length === state.playerOrder.length) {
    return resolveRound({ state, lastInputSeq, reactions, now })
  }
  // 한쪽이 뽑았다 → 상대에게 마지막 유예. 못 뽑으면 그대로 맞는다.
  return {
    ...state,
    version: state.version + 1,
    reactions,
    lastInputSeq,
    nextActionAt: Math.min(state.nextActionAt, now + GRACE_MILLIS),
    lastRound: undefined,
  }
}

/** 유예·동결이 끝났다. 안 뽑은 쪽은 얼어붙은 것으로 기록한다. */
export const expire = (state: DuelState, now: number): DuelState => {
  if (state.phase !== 'SIGNAL') return state
  const reactions = copy(state.reactions)
  for (const player of state.playerOrder) {
    if (reactions[player] === undefined) reactions[player] = MISS
  }
  return resolveRound({ state, lastInputSeq: state.lastInputSeq, reactions, now })
}

/** 결과 연출이 끝났다 → 다음 라운드의 빨간 신호등으로. */
export const nextRound = (state: DuelState, now: number, wait: number): DuelState => {
  if (state.phase !== 'RESULT' || state.lastRound === undefined) return state
  if (state.lastRound.over) return state
  return {
    ...state,
    version: state.version + 1,
    phase: 'WAITING',
    reactions: {},
    round: state.round + 1,
    signalAt: 0,
    nextActionAt: now + wait,
    lastRound: undefined,
  }
}

/** KO 연출이 끝났다 → 결과 화면으로. */
export const finish = (state: DuelState): DuelState => {
  if (state.phase !== 'RESULT' || state.lastRound === undefined) return state
  if (!state.lastRound.over) return state
  return { ...state, version: state.version + 1, phase: 'FINISHED', nextActionAt: 0 }
}

/** 한쪽이 방을 떠났다 — 남은 쪽이 살아남는다. */
export const forfeit = (state: DuelState, playerId: string, now: number): DuelState => {
  if (state.phase === 'FINISHED' || !state.playerOrder.includes(playerId)) return state
  const [first, second] = sides(state)
  const survivor = state.playerOrder.indexOf(playerId) === 0 ? second : first
  const hp = copy(state.hp)
  hp[playerId] = 0
  return {
    ...state,
    version: state.version + 1,
    phase: 'FINISHED',
    hp,
    reactions: {},
    signalAt: 0,
    nextActionAt: 0,
    lastRound: {
      number: state.round,
      kind: 'FORFEIT',
      shooterId: survivor,
      hitId: playerId,
      koId: playerId,
      foulId: null,
      over: true,
      at: now,
    },
  }
}
