import type { YachtCategory } from './scoring'

/**
 * 조별과제 야트(S15P11A406-209)의 규칙 — 순수 함수만.
 *
 * 3인 1팀 · 점수판 1개 공유 · 12라운드. 일반 야추의 "1라운드 = 한 사람이 3굴림"을
 * **"1라운드 = 세 사람이 1굴림씩"** 으로 치환한다.
 *
 * 1. **1번 주자**: 5개 전부 굴리고 1~3개를 킵한다.
 * 2. **2번 주자**: 앞 사람이 킵한 눈만 보인다(버린 눈은 값이 가려진 채 넘어온다). 앞 사람의 킵은
 *    해제할 수 없다. 남은 걸 굴린 뒤 1개 ~ (남은 수 − 1)개를 킵한다 — 3번 주자가 굴릴 주사위가
 *    최소 1개 남아야 한다.
 * 3. **3번 주자**: 남은 걸 굴린다. 마지막 굴림이라 킵 선택 없이 5개가 확정된다.
 * 4. **기록 = 다수결**: 세 명이 각자 족보를 지목해 2표 이상 받은 칸에 기록한다. 전원 다른
 *    족보면 룰렛으로 정한다.
 * 5. 다음 라운드는 주자 순서가 한 칸 로테이션된다. 12라운드 = 각 좌석 정확히 4번.
 *
 * **판정의 권위는 서버다.** 여기 있는 함수들은 화면이 버튼을 잠그고 룰렛 연출을 그리기 위한
 * 것이고, 킵 개수 제약과 룰렛 결과는 서버(`backend/.../teamyacht/TeamYachtRules.java`)가 다시
 * 판단한다 — 클라이언트 검증만으로는 우회된다.
 *
 * `scoring.ts`는 수정하지 않는다(서버와 공유하는 SSOT).
 */

export const TEAM_YACHT_ROUNDS = 12
export const TEAM_YACHT_SEATS = 3
export const TEAM_YACHT_DICE_COUNT = 5

export type TeamYachtStage = 'ROLL' | 'KEEP' | 'VOTE' | 'FINISHED'

/** 한 라운드의 기록 결과. `rouletteCandidates`가 있으면 동표라 룰렛으로 정해진 것이다. */
export interface TeamYachtRecord {
  round: number
  category: YachtCategory
  score: number
  rouletteCandidates?: YachtCategory[] | null
  rouletteSeed?: number | null
}

/**
 * 서버가 **나에게만** 보내주는 판의 모양(`game.team_yacht.state`).
 *
 * `dice`의 null은 "내게 보이지 않는 주사위"다 — 앞 주자가 버린 눈은 서버가 애초에 보내지
 * 않는다. 눈이 보이는 조건은 이미 킵돼 잠긴 주사위이거나, 내가 지금 굴린 주자일 때다.
 */
export interface TeamYachtView {
  stage: TeamYachtStage
  round: number
  rounds: number
  /** 이번 라운드의 주자 순서(index 0 = 1번 주자). */
  seats: string[]
  leg: number
  runnerId?: string | null
  dice: Array<number | null>
  kept: boolean[]
  /** 지금 주자가 킵해야 하는 개수 범위. 킵 단계가 아니면 둘 다 0이다. */
  minKeep: number
  maxKeep: number
  votes: Record<string, YachtCategory>
  board: TeamYachtBoard
  last?: TeamYachtRecord | null
}

/** 팀이 공유하는 점수판. 필드 모양은 `ScoreBoard`(wsEvents)와 같다. */
export interface TeamYachtBoard {
  categories: Record<YachtCategory, number | null>
  upperSubtotal: number
  upperBonus: number
  total: number
}

/**
 * 이번 주자가 킵해야 하는 개수 범위.
 *
 * 최소 1개는 무임승차 방지다(아무것도 킵하지 않고 넘길 수 없다). 최대치는 "뒤에 남은 주자
 * 수만큼은 굴릴 주사위를 남긴다"로 정해진다 — 1번 주자는 5개 중 최대 3개, 2번 주자는
 * 남은 수 − 1개다.
 */
export function keepBounds(leg: number, kept: readonly boolean[]) {
  const rollable = kept.filter((locked) => !locked).length
  const runnersAfter = TEAM_YACHT_SEATS - 1 - leg
  return { min: 1, max: Math.max(1, rollable - runnersAfter) }
}

export function isValidKeep(leg: number, kept: readonly boolean[], picks: readonly number[]) {
  const unique = new Set(picks)
  if (unique.size !== picks.length) return false
  if (picks.some((index) => index < 0 || index >= TEAM_YACHT_DICE_COUNT || kept[index])) return false
  const { max, min } = keepBounds(leg, kept)
  return unique.size >= min && unique.size <= max
}

/**
 * 다수결 집계. 2표 이상 받은 족보가 있으면 그 칸이고, 전원 다른 족보면 룰렛으로 넘긴다.
 * 후보 순서는 좌석 순서다 — 서버와 같은 순서여야 룰렛 결과가 같다.
 */
export function tallyVotes(
  seats: readonly string[],
  votes: Readonly<Record<string, YachtCategory>>,
): { winner: YachtCategory } | { candidates: YachtCategory[] } | null {
  const candidates = seats.map((seat) => votes[seat])
  if (candidates.some((category) => category === undefined)) return null

  const majority = candidates.find(
    (category) => candidates.filter((other) => other === category).length >= 2,
  )
  return majority ? { winner: majority } : { candidates }
}

/**
 * 동표 룰렛. **결과를 정하는 쪽은 서버다** — 화면은 서버가 내려준 값에서 멈추는 연출만 한다.
 * 여기 있는 계산은 백엔드 `TeamYachtRules.rouletteWinner`와 같은 값을 내야 한다(같은 LCG).
 */
export function rouletteWinner<T>(seed: number, candidates: readonly T[]): T {
  return candidates[Math.floor((normalizeSeed(seed) / 2 ** 32) * candidates.length)] as T
}

/** 주자 순서를 한 칸 당긴다: 1→2→3번 주자가 2→3→1번이 된다. */
export function rotateSeats<T>(seats: readonly T[]): T[] {
  return [...seats.slice(1), ...seats.slice(0, 1)]
}

/** LCG 한 걸음. `dice.ts`의 `nextRollSeed`와 같은 상수를 쓴다(서버도 같은 값). */
export function nextSeed(seed: number) {
  return (Math.imul(normalizeSeed(seed), 1_664_525) + 1_013_904_223) >>> 0
}

function normalizeSeed(seed: number) {
  return Math.trunc(seed) >>> 0
}
