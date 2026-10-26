import { DomainError } from '../../errors.js'
import type { DuelPlayerNumbers, DuelRound, DuelState } from './duelState.js'

/**
 * 한 라운드의 **판정**만 모은 파일 — 반응 비교, 파울 정산, 쏘기.
 *
 * 상태 전이(`duelRules.ts`)와 갈라 둔 이유는 이쪽이 "이미 모인 반응을 어떻게
 * 해석하는가"만 알기 때문이다. 전이는 시각·마감·입력 번호를 다루고, 판정은 총알과
 * 경고만 다룬다. 한 파일에 두면 읽는 사람이 두 관심사를 번갈아 붙잡아야 하고,
 * 파일 단위 할스테드 난이도도 상한을 넘는다.
 *
 * 부정출발 규칙의 근거는 `duelRules.ts`의 파일 주석에 있다.
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

/* 연출 시간 — 프런트 duel.ts의 CSS 애니메이션 길이와 맞춰야 한다. */
/** 아무도 맞지 않은 라운드(TIE·경고)는 짧게 보여준다. */
export const TIE_HOLD_MILLIS = 1_650
export const RESULT_HOLD_MILLIS = 2_150
export const KO_HOLD_MILLIS = 2_900

const copy = (values: DuelPlayerNumbers): Record<string, number> => ({ ...values })

const at = (values: DuelPlayerNumbers, playerId: string, fallback: number): number =>
  values[playerId] ?? fallback

/** playerOrder는 항상 2명이다 — 그 불변식을 판정 쪽에서도 한 번만 꺼내 쓴다. */
const sides = (state: DuelState): readonly [string, string] => {
  const [first, second] = state.playerOrder
  if (first === undefined || second === undefined) {
    throw new DomainError('duel_requires_two_players')
  }
  return [first, second]
}

/**
 * 두 반응을 비교 → 0=TIE · 1=첫 번째 승 · 2=두 번째 승.
 * 둘 다 정상이면 더 빠른 쪽이 이기고 1ms까지 같으면 TIE, 한쪽만 정상이면 그쪽이 이긴다.
 * 둘 다 실패면(둘 다 성급했거나 둘 다 얼어붙음) TIE다.
 */
export const compareDraw = (a: number, b: number): 0 | 1 | 2 => {
  const cleanA = a >= 0
  const cleanB = b >= 0
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

export interface ResolveInput {
  readonly state: DuelState
  readonly lastInputSeq: DuelPlayerNumbers
  readonly reactions: DuelPlayerNumbers
  readonly now: number
}

/** 모인 반응으로 라운드를 확정한다 — 반환값은 hp·fouls가 반영된 새 상태다. */
export const resolveRound = ({ state, lastInputSeq, reactions, now }: ResolveInput): DuelState => {
  const [first, second] = sides(state)
  const hp = copy(state.hp)
  const fouls = copy(state.fouls)

  const foulId = foulSide(reactions, first, second)
  const round =
    foulId === null
      ? shootout({ state, reactions, hp, first, second, now })
      : penalty({ state, hp, fouls, foulId, now })

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
interface PenaltyInput {
  readonly state: DuelState
  readonly hp: Record<string, number>
  readonly fouls: Record<string, number>
  readonly foulId: string
  readonly now: number
}

const penalty = ({ state, hp, fouls, foulId, now }: PenaltyInput): DuelRound => {
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
interface ShootoutInput {
  readonly state: DuelState
  readonly reactions: DuelPlayerNumbers
  readonly hp: Record<string, number>
  readonly first: string
  readonly second: string
  readonly now: number
}

const shootout = ({ state, reactions, hp, first, second, now }: ShootoutInput): DuelRound => {
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
