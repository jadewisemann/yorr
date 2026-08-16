import { describe, expect, it } from 'vitest'
import { YACHT_DICE } from '../../catalog.js'
import { CachingWeeklyRankingRepository, weeklyRankingCacheKey } from '../weeklyRankingCache.js'
import { WeeklyRankingService } from '../weeklyRankingService.js'
import type { WeeklyBest, WeeklyRankingRepository } from '../weeklyRankingStore.js'

/**
 * 이식: backend-java `WeeklyRankingQueryIntegrationTest`의 캐시 3종
 * (`같은_주를_다시_물으면_캐시가_답한다`, `같은_주라도_게임이_다르면_별도_캐시`,
 * `판이_끝나면_캐시가_비워진다`).
 *
 * Java는 Spring 캐시 프록시를 확인해야 해서 MySQL 컨테이너 위에서 돌았고 "리포지토리로
 * 직접 넣은 행이 보이지 않는 것"이 캐시의 증거였다. Node에서는 캐시가 데코레이터라
 * **위임 호출 횟수**로 같은 것을 직접 본다 — MySQL 없이 돌고, 확인하려는 것(캐시가
 * 실제로 걸렸는가)은 더 정확하다.
 */

const WEEK_FROM = new Date('2026-08-02T15:00:00.000Z')
const WEEK_TO = new Date('2026-08-09T15:00:00.000Z')

class CountingRepository implements WeeklyRankingRepository {
  bestQueries = 0
  myScoreQueries = 0
  countQueries = 0
  /** 게임 코드별 응답. 캐시가 게임을 섞지 않는지 보려면 값이 달라야 한다. */
  rowsByGame = new Map<string, readonly WeeklyBest[]>()

  async findWeeklyBest(gameCode: string, _from: Date, _to: Date, limit: number) {
    this.bestQueries += 1
    return (this.rowsByGame.get(gameCode) ?? []).slice(0, limit)
  }

  async findWeeklyBestScoreOf() {
    this.myScoreQueries += 1
    return 100
  }

  async countMembersScoringMoreThan() {
    this.countQueries += 1
    return 3
  }
}

describe('주간 랭킹 캐시', () => {
  const row = (userId: string, bestScore: number): WeeklyBest => ({
    userId,
    nickname: userId,
    bestScore,
  })

  describe('키 규약', () => {
    it('gameCode|from(UTC ISO)|limit 이다', () => {
      expect(weeklyRankingCacheKey(YACHT_DICE, WEEK_FROM, 100)).toBe(
        'YACHT_DICE|2026-08-02T15:00:00.000Z|100',
      )
    })

    /** 주가 바뀌면 자연히 다른 항목이다 — 지난 주 순위가 잠시 남아 보이는 경로가 없다. */
    it('주가 다르면 다른 키다', () => {
      expect(weeklyRankingCacheKey(YACHT_DICE, WEEK_FROM, 100)).not.toBe(
        weeklyRankingCacheKey(YACHT_DICE, WEEK_TO, 100),
      )
    })

    /** 목록은 이미 잘린 결과다 — limit이 키에 없으면 10명짜리가 100명 요청에 재사용된다. */
    it('limit이 다르면 다른 키다', () => {
      expect(weeklyRankingCacheKey(YACHT_DICE, WEEK_FROM, 10)).not.toBe(
        weeklyRankingCacheKey(YACHT_DICE, WEEK_FROM, 100),
      )
    })

    it('게임이 다르면 다른 키다', () => {
      expect(weeklyRankingCacheKey('PING_PONG', WEEK_FROM, 100)).not.toBe(
        weeklyRankingCacheKey(YACHT_DICE, WEEK_FROM, 100),
      )
    })
  })

  it('같은 주를 다시 물으면 캐시가 답한다', async () => {
    const delegate = new CountingRepository()
    delegate.rowsByGame.set(YACHT_DICE, [row('u1', 200)])
    const cached = new CachingWeeklyRankingRepository(delegate)

    const first = await cached.findWeeklyBest(YACHT_DICE, WEEK_FROM, WEEK_TO, 100)
    // 그 사이 새 판이 쌓였다고 하자. evict 없이는 보이지 않는 것이 캐시의 증거다.
    delegate.rowsByGame.set(YACHT_DICE, [row('u1', 500)])
    const second = await cached.findWeeklyBest(YACHT_DICE, WEEK_FROM, WEEK_TO, 100)

    expect(delegate.bestQueries).toBe(1)
    expect(second).toEqual(first)
    expect(second.map((entry) => entry.bestScore)).toEqual([200])
  })

  /** 아무도 없는 주가 가장 흔한 캐시 미스 후보다 — 빈 결과도 항목이어야 한다. */
  it('빈 결과도 캐시된다', async () => {
    const cached = new CachingWeeklyRankingRepository(new CountingRepository())

    expect(await cached.findWeeklyBest(YACHT_DICE, WEEK_FROM, WEEK_TO, 100)).toEqual([])
    expect(await cached.findWeeklyBest(YACHT_DICE, WEEK_FROM, WEEK_TO, 100)).toEqual([])
    expect(cached.size).toBe(1)
  })

  it('같은 주라도 게임이 다르면 별도 캐시를 사용한다', async () => {
    const delegate = new CountingRepository()
    delegate.rowsByGame.set(YACHT_DICE, [row('yacht', 200)])
    delegate.rowsByGame.set('PING_PONG', [row('pong', 11)])
    const cached = new CachingWeeklyRankingRepository(delegate)

    const yacht = await cached.findWeeklyBest(YACHT_DICE, WEEK_FROM, WEEK_TO, 100)
    const pingPong = await cached.findWeeklyBest('PING_PONG', WEEK_FROM, WEEK_TO, 100)

    expect(yacht.map((entry) => entry.bestScore)).toEqual([200])
    expect(pingPong.map((entry) => entry.bestScore)).toEqual([11])
    expect(cached.size).toBe(2)
  })

  it('주가 바뀌면 새 항목을 만든다', async () => {
    const delegate = new CountingRepository()
    const cached = new CachingWeeklyRankingRepository(delegate)

    await cached.findWeeklyBest(YACHT_DICE, WEEK_FROM, WEEK_TO, 100)
    await cached.findWeeklyBest(YACHT_DICE, WEEK_TO, new Date('2026-08-16T15:00:00.000Z'), 100)

    expect(delegate.bestQueries).toBe(2)
    expect(cached.size).toBe(2)
  })

  /**
   * 전적 보관(4.4)이 부르는 자리. Java `MatchArchiveService`의
   * `@CacheEvict(allEntries = true)`와 같다 — 주·게임을 가리지 않고 통째로 버린다.
   */
  it('판이 끝나면(evictAll) 캐시가 비워진다', async () => {
    const delegate = new CountingRepository()
    delegate.rowsByGame.set(YACHT_DICE, [row('u1', 200)])
    const cached = new CachingWeeklyRankingRepository(delegate)
    await cached.findWeeklyBest(YACHT_DICE, WEEK_FROM, WEEK_TO, 100)
    delegate.rowsByGame.set(YACHT_DICE, [row('u1', 500)])

    cached.evictAll()

    expect(cached.size).toBe(0)
    expect(
      (await cached.findWeeklyBest(YACHT_DICE, WEEK_FROM, WEEK_TO, 100)).map(
        (entry) => entry.bestScore,
      ),
    ).toEqual([500])
    expect(delegate.bestQueries).toBe(2)
  })

  it('여러 주·여러 게임의 항목을 한 번에 버린다', async () => {
    const cached = new CachingWeeklyRankingRepository(new CountingRepository())
    await cached.findWeeklyBest(YACHT_DICE, WEEK_FROM, WEEK_TO, 100)
    await cached.findWeeklyBest(YACHT_DICE, WEEK_FROM, WEEK_TO, 10)
    await cached.findWeeklyBest('PING_PONG', WEEK_TO, new Date('2026-08-16T15:00:00.000Z'), 100)
    expect(cached.size).toBe(3)

    cached.evictAll()

    expect(cached.size).toBe(0)
  })

  /** 사용자별 값이라 캐시하면 항목이 회원 수만큼 늘어난다. */
  it('내 순위 질의는 캐시하지 않는다', async () => {
    const delegate = new CountingRepository()
    const cached = new CachingWeeklyRankingRepository(delegate)

    await cached.findWeeklyBestScoreOf('me', YACHT_DICE, WEEK_FROM, WEEK_TO)
    await cached.findWeeklyBestScoreOf('me', YACHT_DICE, WEEK_FROM, WEEK_TO)
    await cached.countMembersScoringMoreThan(100, YACHT_DICE, WEEK_FROM, WEEK_TO)
    await cached.countMembersScoringMoreThan(100, YACHT_DICE, WEEK_FROM, WEEK_TO)

    expect(delegate.myScoreQueries).toBe(2)
    expect(delegate.countQueries).toBe(2)
    expect(cached.size).toBe(0)
  })

  /** 서비스는 자기가 캐시를 보고 있는지 모른다 — 데코레이터를 끼운 배선을 그대로 시험한다. */
  it('서비스 뒤에 끼워도 같은 결과를 낸다', async () => {
    const delegate = new CountingRepository()
    delegate.rowsByGame.set(YACHT_DICE, [row('u1', 300), row('u2', 300), row('u3', 100)])
    const cached = new CachingWeeklyRankingRepository(delegate)
    const service = new WeeklyRankingService(cached, () => new Date('2026-08-05T03:00:00.000Z'))

    const first = await service.currentWeek(100)
    const second = await service.currentWeek(100)

    expect(second).toEqual(first)
    expect(delegate.bestQueries).toBe(1)
    expect(cached.size).toBe(1)
    // 캐시 키의 from이 곧 이 주의 시작이다.
    expect(first.weekStart).toBe('2026-08-03')
  })
})
