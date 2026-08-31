import {
  isUpperCategory,
  SCORE_CATEGORIES,
  type ScoreBoard,
  type ScoreCategory,
  UPPER_BONUS_SCORE,
  UPPER_BONUS_THRESHOLD,
} from '../../score/index.js'
import { BotDecisionError } from './botErrors.js'

/**
 * 봇의 **휴리스틱 가치 함수**.
 *
 * ⚠️ `YachtScoreCalculator`(룰북)와 혼동하면 안 된다. 저쪽은 순수·정수·유일한
 * 채점 권위고, 여기는 **부동소수·비영속·봇 전용**이다. 이 값이 점수판에 들어가는
 * 경로는 없다(docs/design/games/yacht.md 「채점 vs 봇 평가」).
 *
 * 세 항의 합이다:
 * ① 즉시 점수 ② 상단 보너스를 이 칸으로 **확보**하면 +35와 확보 프리미엄
 * ③ 남은 칸의 기대값에 미래 할인 0.70.
 */

/** 보너스를 실제로 확보하는 수에만 얹는 가산점 — "지금 확정"을 미래 기대보다 높게 본다. */
const SECURED_BONUS_PREMIUM = 4.0
/** 보너스 도달 확률 로지스틱의 스케일(점수 단위). 작을수록 계단에 가까워진다. */
const BONUS_CURVE_SCALE = 5.0
/**
 * 다음 턴의 기준 점수를 확정값처럼 취급하면 현재의 좋은 패를 버리는 과도한 낙관이
 * 생긴다.
 */
const FUTURE_VALUE_DISCOUNT = 0.7

/**
 * 칸별 기준 기대값. **경험적 상수이고 룰과 무관**하다 — 상단은 "그 눈 3개 정도",
 * 하단은 "그 족보를 노려서 얻는 평균"에 가깝게 잡혀 있다.
 */
const BASELINE_VALUES: Readonly<Record<ScoreCategory, number>> = Object.freeze({
  ones: 2.0,
  twos: 5.0,
  threes: 8.0,
  fours: 12.0,
  fives: 15.0,
  sixes: 18.0,
  choice: 20.0,
  fourOfAKind: 10.0,
  fullHouse: 8.0,
  smallStraight: 12.0,
  largeStraight: 7.0,
  yacht: 3.0,
})

/**
 * 상단 카테고리가 한 칸에서 낼 수 있는 최대치 = 눈 × 5. Java는
 * `(category.ordinal() + 1) * 5`로 같은 값을 만든다(상단 6개의 ordinal이 눈−1이다).
 */
const upperCategoryMaximum = (category: ScoreCategory): number =>
  (SCORE_CATEGORIES.indexOf(category) + 1) * 5

/**
 * 아직 안 채운 칸들의 가치 + 상단 보너스 기대값.
 *
 * 배열을 만들지 않고 12칸을 한 번 훑는다 — 이 함수가 탐색 한 번에 수백 번
 * 불리므로(`bestScore`가 열린 칸마다 부른다) 할당을 피하는 쪽이 낫다. Java의
 * `EnumSet` 사본과 결과는 같다.
 */
const remainingPotential = (
  board: ScoreBoard,
  excluded: ScoreCategory | null,
  upperSubtotal: number,
): number => {
  let categoryPotential = 0
  let upperExpected = 0
  let upperMaximum = 0
  for (const category of SCORE_CATEGORIES) {
    if (category === excluded) continue
    if (board.categories[category] !== null) continue
    const baseline = BASELINE_VALUES[category]
    categoryPotential += baseline
    if (isUpperCategory(category)) {
      upperExpected += baseline
      upperMaximum += upperCategoryMaximum(category)
    }
  }
  return categoryPotential + upperBonusPotential(upperSubtotal, upperExpected, upperMaximum)
}

/**
 * 상단 보너스 35점의 기대값.
 *
 * 이미 확보했으면 0(중복 계산 금지), 남은 칸을 다 만점 받아도 63에 못 미치면 0
 * (수학적으로 불가능한 희망에 값을 주지 않는다). 그 사이는 "기준값대로 채웠을 때
 * 63과의 거리"를 로지스틱으로 확률로 바꾼다.
 */
const upperBonusPotential = (
  upperSubtotal: number,
  upperExpected: number,
  upperMaximum: number,
): number => {
  if (upperSubtotal >= UPPER_BONUS_THRESHOLD) return 0
  if (upperSubtotal + upperMaximum < UPPER_BONUS_THRESHOLD) return 0
  const distance = upperSubtotal + upperExpected - UPPER_BONUS_THRESHOLD
  const probability = 1 / (1 + Math.exp(-distance / BONUS_CURVE_SCALE))
  return UPPER_BONUS_SCORE * probability
}

const requireOpen = (board: ScoreBoard, category: ScoreCategory): void => {
  if (board === null || board === undefined || category === null || category === undefined) {
    throw new BotDecisionError('scoreboard and category are required')
  }
  if (board.categories[category] !== null && board.categories[category] !== undefined) {
    throw new BotDecisionError(`category is already filled: ${category}`)
  }
}

export class ScorecardValueEvaluator {
  /**
   * 이 점수판 상태에서 `category`에 `score`를 기록하는 것의 가치.
   *
   * @throws {BotDecisionError} 이미 채워진 칸을 평가하려 하면(Java
   * `IllegalArgumentException`) — 코디네이터가 잡아 폴백 정책으로 내려간다.
   */
  categoryUtility(board: ScoreBoard, category: ScoreCategory, score: number): number {
    requireOpen(board, category)

    const nextUpperSubtotal = board.upperSubtotal + (isUpperCategory(category) ? score : 0)
    // "확보"는 이 수로 **처음** 63을 넘기는 경우만이다. 이미 넘겨 뒀다면 보너스는
    // 이 선택의 공이 아니다.
    const bonusSecured =
      board.upperSubtotal < UPPER_BONUS_THRESHOLD && nextUpperSubtotal >= UPPER_BONUS_THRESHOLD
    const immediateValue = bonusSecured ? score + UPPER_BONUS_SCORE + SECURED_BONUS_PREMIUM : score
    return (
      immediateValue +
      FUTURE_VALUE_DISCOUNT * remainingPotential(board, category, nextUpperSubtotal)
    )
  }
}
