import { describe, expect, it } from 'vitest'
import { weeklyRankingResponse } from '../weeklyRankingResponse.js'
import type { WeeklyBest } from '../weeklyRankingStore.js'

/**
 * 이식: backend-java `WeeklyRankingResponseTest` 2종 + `WeeklyRankingQueryIntegrationTest`의
 * `내_순위는_목록에_적히는_번호와_같다`의 번호 체계 부분(MySQL 없이 확인되는 절반).
 */
describe('주간 랭킹 응답 조립', () => {
  const row = (userId: string, nickname: string, bestScore: number): WeeklyBest => ({
    userId,
    nickname,
    bestScore,
  })

  it('동점자는 같은 순위를 받고 다음 순위를 건너뛴다', () => {
    const response = weeklyRankingResponse({
      weekStart: '2026-08-03',
      rows: [
        row('u1', '일등', 300),
        row('u2', '공동이등', 250),
        row('u3', '공동이등', 250),
        row('u4', '사등', 200),
      ],
    })

    expect(response.weekStart).toBe('2026-08-03')
    expect(response.entries.map((entry) => [entry.rank, entry.userId])).toEqual([
      [1, 'u1'],
      [2, 'u2'],
      [2, 'u3'],
      [4, 'u4'],
    ])
  })

  it('아무도 없는 주는 빈 목록이다', () => {
    expect(weeklyRankingResponse({ weekStart: '2026-08-03', rows: [] }).entries).toEqual([])
  })

  /**
   * 번호가 곧 "나보다 잘한 사람 수 + 1"이라 `myCurrentWeek`
   * (`countMembersScoringMoreThan + 1`)과 값이 같아야 한다. 갈리면 같은 사람이
   * 화면 두 곳에서 다른 순위로 보인다.
   */
  it('순위 번호는 나보다 높은 점수의 사람 수 + 1이다', () => {
    const rows = [
      row('u1', '일등', 300),
      row('u2', '공동이등', 250),
      row('u3', '공동이등', 250),
      row('u4', '나', 100),
    ]

    const entries = weeklyRankingResponse({ weekStart: '2026-08-03', rows }).entries

    for (const entry of entries) {
      const better = rows.filter((other) => other.bestScore > entry.bestScore).length
      expect(entry.rank).toBe(better + 1)
    }
  })

  /** 전원 동점이면 모두 1위다 — 번호가 밀려나지 않는다. */
  it('전원 동점이면 모두 1위다', () => {
    const response = weeklyRankingResponse({
      weekStart: '2026-08-03',
      rows: [row('u1', '가', 100), row('u2', '나', 100), row('u3', '다', 100)],
    })

    expect(response.entries.map((entry) => entry.rank)).toEqual([1, 1, 1])
  })

  /** 0점도 순위에 오른다(무기록과 다르다). */
  it('0점도 순위에 오른다', () => {
    const response = weeklyRankingResponse({
      weekStart: '2026-08-03',
      rows: [row('u1', '일등', 10), row('u2', '영점', 0)],
    })

    expect(response.entries[1]).toEqual({ rank: 2, userId: 'u2', nickname: '영점', bestScore: 0 })
  })

  it('필드 이름은 프론트 계약(camelCase) 그대로다', () => {
    const response = weeklyRankingResponse({
      weekStart: '2026-08-03',
      rows: [row('u1', '일등', 300)],
    })

    expect(response.entries[0]).toEqual({
      rank: 1,
      userId: 'u1',
      nickname: '일등',
      bestScore: 300,
    })
  })
})
