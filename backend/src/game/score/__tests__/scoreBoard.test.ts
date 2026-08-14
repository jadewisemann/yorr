import { describe, expect, it } from 'vitest'
import { createScoreBoard, emptyScoreBoard, openCategoriesOf } from '../scoreBoard.js'
import { SCORE_CATEGORIES } from '../scoreCategory.js'
import { ScoreDomainError } from '../scoreErrors.js'

// backend-java `ScoreBoardTest` 이식 — 핵심은 **null(미기록) vs 0(기록하고 희생)**.
describe('ScoreBoard', () => {
  it('미기록 칸과 확정된 0점을 구분한다', () => {
    const scoreboard = createScoreBoard({ ones: 0 }, 0, 0, 0)

    expect(Object.keys(scoreboard.categories)).toHaveLength(12)
    expect(scoreboard.categories.ones).toBe(0)
    expect(scoreboard.categories.twos).toBeNull()
  })

  it('12키를 선언 순서대로 유지한다(직렬화 순서가 계약이다)', () => {
    expect(Object.keys(createScoreBoard({ yacht: 50 }, 0, 0, 50).categories)).toEqual([
      ...SCORE_CATEGORIES,
    ])
  })

  it('미기록 칸은 JSON에서도 키가 살아 있다', () => {
    const json = JSON.parse(JSON.stringify(createScoreBoard({ ones: 0 }, 0, 0, 0))) as {
      categories: Record<string, number | null>
    }
    expect(Object.keys(json.categories)).toHaveLength(12)
    expect(json.categories.twos).toBeNull()
  })

  it('입력을 방어적으로 복사하고 결과를 얼린다', () => {
    const categories: Record<string, number | null> = { choice: 15 }
    const scoreboard = createScoreBoard(categories, 0, 0, 15)
    categories.choice = 30

    expect(scoreboard.categories.choice).toBe(15)
    expect(() => {
      ;(scoreboard.categories as Record<string, number | null>).yacht = 50
    }).toThrow(TypeError)
  })

  it('음수 점수는 거부한다', () => {
    expect(() => createScoreBoard({ ones: -1 }, 0, 0, 0)).toThrow(ScoreDomainError)
    expect(() => createScoreBoard({}, 0, 0, -1)).toThrow(ScoreDomainError)
  })

  it('빈 점수판은 12칸이 전부 비어 있다', () => {
    expect(openCategoriesOf(emptyScoreBoard())).toEqual([...SCORE_CATEGORIES])
  })

  it('빈 칸 목록은 선언 순서를 지킨다', () => {
    const scoreboard = createScoreBoard({ yacht: 0, fullHouse: 19 }, 0, 0, 19)

    const open = openCategoriesOf(scoreboard)
    expect(open).toHaveLength(SCORE_CATEGORIES.length - 2)
    expect(open).not.toContain('yacht')
    expect(open).not.toContain('fullHouse')
    expect(open[0]).toBe('ones')
  })
})
