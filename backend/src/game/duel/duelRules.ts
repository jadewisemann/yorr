import { DomainError } from '../../errors.js'
import type { DuelPlayerNumbers, DuelRound, DuelState } from './duelState.js'

/**
 * 석양이 진다 — 결투 규칙. **순수 함수라
 * 네트워크·Redis·연출을 전혀 모른다**(DESIGN.md 「코드 구조」의 도메인/전송 분리).
 *
 * 한 라운드 = 신호등 빨강 → (랜덤 대기) → 초록 → 더 빨리 뽑은 쪽이 쏜다 →
 * 상대 체력 -1 → 체력이 0이 되면 쓰러진다(패배).
 *
 * 반응은 ms 정수로 비교하고, 1ms까지 같으면 TIE(체력 변화 없이 다음 라운드)다.
 *
 * **부정출발 — 매치 통산 2번이면 패배**: 신호 전에 뽑으면 1회차는 라운드 무효(상대
 * 무피해)이고 경고만 쌓인다. 경고는 라운드마다 초기화되지 않고 **매치 내내 누적**되며,
 * `MAX_FOULS`개가 차는 순간 남은 총알과 무관하게 그 자리에서 결투를 잃는다.
 * 1회차를 무료로 두는 이유는 탭·폰 흔들기 입력이 손떨림으로 오작동하기 쉬워서다.
 * 반대로 계속 무료면 긴장이 사라지므로 두 번째는 곧바로 승부를 끝낸다. (신호 전에는
 * 아무 정보도 없어 "불리한 라운드를 파울로 회피"하는 악용은 불가능하다.)
 */

/** 결투에서 버틸 수 있는 총알 수. */
export const MAX_HP = 3
/** 매치 통산 이 횟수째 부정출발에서 자기 발을 쏘고 결투를 잃는다. */
export const MAX_FOULS = 2

/**
 * 반응 시간 센티넬 — 실제 ms는 0 이상이다.
 * FOUL은 신호 전에 뽑음, MISS는 신호 후에도 못 뽑음(얼어붙음)이다.
 * **센티넬에 산술을 더하면 안 된다**(와이어 계약: `DUEL_FOUL`·`DUEL_MISS`).
 */
export const FOUL = -1
export const MISS = -2

/** 신호(초록)까지의 랜덤 대기 — 예측 못 하게 넉넉한 폭. 매 라운드 재추첨한다. */
export const MIN_WAIT_MILLIS = 1_400
export const MAX_WAIT_MILLIS = 4_600
/** 한쪽이 먼저 뽑은 뒤, 상대가 뽑을 수 있는 마지막 유예. */
export const GRACE_MILLIS = 700
/** 신호 후 아무도 안 뽑으면 라운드를 무효로 넘긴다. */
export const FREEZE_MILLIS = 2_600

/* 연출 시간 — 프런트 duel.ts의 CSS 애니메이션 길이와 맞춰야 한다. */
/** 아무도 맞지 않은 라운드(TIE·경고)는 짧게 보여준다. */
export const TIE_HOLD_MILLIS = 1_650
export const RESULT_HOLD_MILLIS = 2_150
export const KO_HOLD_MILLIS = 2_900

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
export const draw = (
  state: DuelState,
  playerId: string,
  inputSeq: number,
  reportedMs: number,
  now: number,
): DuelState => {
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
    return resolve(state, lastInputSeq, reactions, now)
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
  return resolve(state, state.lastInputSeq, reactions, now)
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

/**
 * 두 반응을 비교 → 0=TIE · 1=첫 번째 승 · 2=두 번째 승.
 * 둘 다 정상이면 더 빠른 쪽이 이기고 1ms까지 같으면 TIE, 한쪽만 정상이면 그쪽이 이긴다.
 * 둘 다 실패면(둘 다 성급했거나 둘 다 얼어붙음) TIE다.
 */
export const compareDraw = (a: number, b: number): 0 | 1 | 2 => {
  const cleanA = a >= 0
  const cleanB = b >= 0
  // Stryker disable next-line EqualityOperator: 같은 값은 바로 위에서 이미 0으로 갈렸다.
  // `<`와 `<=`가 여기서 같은 뜻이므로 어느 검사로도 가를 수 없다(동치 돌연변이).
  if (cleanA && cleanB) return a === b ? 0 : a < b ? 1 : 2
  if (cleanA) return 1
  if (cleanB) return 2
  return 0
}

/** 연출을 붙잡아 둘 시간 — 실제로 맞은 라운드만 충분히 보여준다. */
export const hold = (round: DuelRound): number => {
  if (round.over) return KO_HOLD_MILLIS
  return round.hitId === null ? TIE_HOLD_MILLIS : RESULT_HOLD_MILLIS
}

const resolve = (
  state: DuelState,
  lastInputSeq: DuelPlayerNumbers,
  reactions: DuelPlayerNumbers,
  now: number,
): DuelState => {
  const [first, second] = sides(state)
  const hp = copy(state.hp)
  const fouls = copy(state.fouls)

  const foulId = foulSide(reactions, first, second)
  const round =
    foulId === null
      ? shootout(state, reactions, hp, first, second, now)
      : penalty(state, hp, fouls, foulId, now)

  return {
    ...state,
    version: state.version + 1,
    phase: 'RESULT',
    hp,
    fouls,
    reactions,
    lastInputSeq,
    nextActionAt: now + hold(round),
    lastRound: round,
  }
}

/**
 * 부정출발 라운드. 상대는 무피해다 — 신호 전이라 총을 뽑지도 않았다.
 *
 * 경고는 라운드를 넘어 누적되고, 한도에 닿는 순간 자기 발을 쏘며 **남은 총알과
 * 무관하게** 결투가 끝난다. 총알 한 발로 환산하지 않는 이유는 그러면 "총알을 아끼는
 * 대신 파울을 쓴다"는 계산이 생기기 때문이다 — 부정출발은 값을 치르는 선택이 아니라
 * 하면 안 되는 일이어야 한다.
 */
const penalty = (
  state: DuelState,
  hp: Record<string, number>,
  fouls: Record<string, number>,
  foulId: string,
  now: number,
): DuelRound => {
  const count = at(fouls, foulId, 0) + 1
  fouls[foulId] = count
  if (count < MAX_FOULS) {
    return {
      number: state.round,
      kind: 'WARNING',
      shooterId: null,
      hitId: null,
      koId: null,
      foulId,
      over: false,
      at: now,
    }
  }
  hp[foulId] = Math.max(0, at(hp, foulId, 0) - 1)
  return {
    number: state.round,
    kind: 'SELF_SHOT',
    shooterId: null,
    hitId: foulId,
    koId: foulId,
    foulId,
    over: true,
    at: now,
  }
}

/** 정상 승부 — 더 빨리 뽑은 쪽이 상대를 쏜다. */
const shootout = (
  state: DuelState,
  reactions: DuelPlayerNumbers,
  hp: Record<string, number>,
  first: string,
  second: string,
  now: number,
): DuelRound => {
  const winner = compareDraw(at(reactions, first, MISS), at(reactions, second, MISS))
  if (winner === 0) {
    return {
      number: state.round,
      kind: 'TIE',
      shooterId: null,
      hitId: null,
      koId: null,
      foulId: null,
      over: false,
      at: now,
    }
  }
  const shooter = winner === 1 ? first : second
  const hit = winner === 1 ? second : first
  const left = Math.max(0, at(hp, hit, 0) - 1)
  hp[hit] = left
  return {
    number: state.round,
    kind: 'SHOT',
    shooterId: shooter,
    hitId: hit,
    koId: left <= 0 ? hit : null,
    foulId: null,
    over: left <= 0,
    at: now,
  }
}

const foulSide = (reactions: DuelPlayerNumbers, first: string, second: string): string | null => {
  if (at(reactions, first, MISS) === FOUL) return first
  if (at(reactions, second, MISS) === FOUL) return second
  return null
}
