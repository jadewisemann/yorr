import { describe, expect, it } from 'vitest'
import { createPrng } from '../../../../test/fuzz/prng.js'
import {
  everyDiceRoll,
  oracleScore,
  oracleSheet,
  YACHT_CATEGORIES,
  type YachtCategory,
} from '../../../../test/oracles/yacht.js'
import type { ScoreCategory } from '../scoreCategory.js'
import {
  calculateScore,
  calculateUpperBonus,
  calculateUpperSubtotal,
} from '../yachtScoreCalculator.js'

/**
 * 차등 테스트 — 같은 규칙의 **세 구현**이 가능한 모든 입력에서 같은 답을 내는지 본다.
 *
 * 1. 서버 계산기(`yachtScoreCalculator.ts`) — 점수를 확정하는 권위 구현
 * 2. 프론트 도메인(`frontend/src/yacht/domain/scoring.ts`) — 화면의 후보 점수
 * 3. 독립 오라클(`test/oracles/yacht.ts`) — 규칙 문장을 곧이곧대로 옮긴 셋째 구현
 *
 * 1과 2가 어긋나면 화면이 보여 준 점수와 기록되는 점수가 다르다. 셋 중 둘만 같으면 누가
 * 틀렸는지도 바로 보인다. 주사위 입력 공간이 6^5 = 7,776으로 작아서 **전수**로 돈다.
 */

interface FrontendScoring {
  scoreCategory(dice: readonly number[], category: YachtCategory): number
  calculateScoreSummary(categories: Partial<Record<YachtCategory, number>>): {
    readonly upperSubtotal: number
    readonly upperBonus: number
    readonly total: number
  }
}

/**
 * 경로를 문자열 리터럴이 아니라 URL로 만든다 — tsc가 프론트 파일을 따라가 백엔드 설정으로
 * 타입 검사하지 않게 하려는 것이다(프론트는 Bundler 해석을 쓴다). 실행은 vitest가 변환한다.
 * 프론트 파일이 옮겨지면 여기서 크게 실패한다 — 조용히 건너뛰지 않는다.
 */
const loadFrontendScoring = async (): Promise<FrontendScoring> => {
  const url = new URL('../../../../../frontend/src/yacht/domain/scoring.ts', import.meta.url)
  return (await import(url.href)) as FrontendScoring
}

const asBackendMap = (
  categories: Readonly<Partial<Record<YachtCategory, number>>>,
): Map<ScoreCategory, number> => new Map(Object.entries(categories) as [ScoreCategory, number][])

describe('야추 점수 — 서버·프론트·오라클 차등 테스트', () => {
  it('7,776가지 주사위 × 12칸 전부에서 세 구현의 점수가 같다', async () => {
    const frontend = await loadFrontendScoring()
    const mismatches: string[] = []
    let compared = 0

    for (const dice of everyDiceRoll()) {
      for (const category of YACHT_CATEGORIES) {
        const server = calculateScore(category, dice)
        const client = frontend.scoreCategory(dice, category)
        const oracle = oracleScore(category, dice)
        compared += 1
        if (server !== oracle || client !== oracle) {
          mismatches.push(
            `${category} ${dice.join('')}: 서버 ${server} · 프론트 ${client} · 오라클 ${oracle}`,
          )
        }
      }
    }

    expect(compared).toBe(7_776 * 12)
    expect(mismatches.slice(0, 10)).toEqual([])
  })

  it('상단 소계·보너스가 무작위 점수판 2,000장에서 같다 (시드 고정)', async () => {
    const frontend = await loadFrontendScoring()
    const random = createPrng(20260930)
    const rolls = [...everyDiceRoll()]

    for (let sheet = 0; sheet < 2_000; sheet += 1) {
      const recorded: Partial<Record<YachtCategory, number>> = {}
      for (const category of YACHT_CATEGORIES) {
        if (random.chance(0.6)) recorded[category] = oracleScore(category, random.pick(rolls))
      }
      const oracle = oracleSheet(recorded)
      const scores = asBackendMap(recorded)
      const client = frontend.calculateScoreSummary(recorded)

      expect({
        server: [calculateUpperSubtotal(scores), calculateUpperBonus(scores)],
        client: [client.upperSubtotal, client.upperBonus, client.total],
      }).toEqual({
        server: [oracle.upperSubtotal, oracle.upperBonus],
        client: [oracle.upperSubtotal, oracle.upperBonus, oracle.total],
      })
    }
  })

  it.each([
    { upper: { sixes: 30, fives: 20, fours: 12 }, subtotal: 62, bonus: 0 },
    { upper: { sixes: 30, fives: 20, fours: 12, ones: 1 }, subtotal: 63, bonus: 35 },
    { upper: { sixes: 30, fives: 20, fours: 12, twos: 2 }, subtotal: 64, bonus: 35 },
  ])('보너스 경계: 상단 소계 $subtotal → $bonus', async ({ upper, subtotal, bonus }) => {
    const frontend = await loadFrontendScoring()
    const scores = asBackendMap(upper)

    expect(calculateUpperSubtotal(scores)).toBe(subtotal)
    expect(calculateUpperBonus(scores)).toBe(bonus)
    expect(frontend.calculateScoreSummary(upper).upperBonus).toBe(bonus)
    expect(oracleSheet(upper).upperBonus).toBe(bonus)
  })
})
