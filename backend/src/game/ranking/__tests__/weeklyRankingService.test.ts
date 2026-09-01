import { describe, expect, it } from 'vitest'
import { YACHT_DICE } from '../../catalog.js'
import { MAX_LIMIT, WeeklyRankingService } from '../weeklyRankingService.js'
import type { WeeklyBest, WeeklyRankingRepository } from '../weeklyRankingStore.js'

/**
 * 호출을 기록하는 가짜 리포지토리를 쓴다 — **MySQL 없이 돈다**.
 * 서비스가 고정하는 것은 저장소가 아니라
 * "어떤 구간·어떤 게임 코드·어떤 limit으로 물었는가"다.
 */

interface Call {
  readonly gameCode: string
  readonly from: string
  readonly to: string
  readonly limit?: number
  readonly userId?: string
  readonly score?: number
}

class RecordingRepository implements WeeklyRankingRepository {
  readonly bestCalls: Call[] = []
  readonly myScoreCalls: Call[] = []
  readonly countCalls: Call[] = []
  rows: readonly WeeklyBest[] = []
  myBest: number | undefined
  better = 0

  async findWeeklyBest(gameCode: string, from: Date, to: Date, limit: number) {
    this.bestCalls.push({ gameCode, from: from.toISOString(), to: to.toISOString(), limit })
    return this.rows
  }

  async findWeeklyBestScoreOf(userId: string, gameCode: string, from: Date, to: Date) {
    this.myScoreCalls.push({
      gameCode,
      userId,
      from: from.toISOString(),
      to: to.toISOString(),
    })
    return this.myBest
  }

  async countMembersScoringMoreThan(score: number, gameCode: string, from: Date, to: Date) {
    this.countCalls.push({ gameCode, score, from: from.toISOString(), to: to.toISOString() })
    return this.better
  }
}

describe('WeeklyRankingService', () => {
  const serviceAt = (utcInstant: string) => {
    const participants = new RecordingRepository()
    const service = new WeeklyRankingService(participants, () => new Date(utcInstant))
    return { participants, service }
  }

  /**
   * 경계 계산 자체는 `weekBoundary.test.ts`가 보고, 여기서는 **그 값이 실제로
   * 질의에 실리는지**를 본다.
   */
  it('KST 월요일 00:00을 UTC 구간으로 바꿔 질의한다', async () => {
    const { participants, service } = serviceAt('2026-08-02T15:00:00.000Z')

    const result = await service.currentWeek(10)

    expect(result.weekStart).toBe('2026-08-03')
    expect(participants.bestCalls).toEqual([
      {
        gameCode: YACHT_DICE,
        from: '2026-08-02T15:00:00.000Z',
        to: '2026-08-09T15:00:00.000Z',
        limit: 10,
      },
    ])
  })

  it('월요일 0시 KST 1초 전은 아직 지난 주 구간을 묻는다', async () => {
    const { participants, service } = serviceAt('2026-08-02T14:59:59.000Z')

    const result = await service.currentWeek(10)

    expect(result.weekStart).toBe('2026-07-27')
    expect(participants.bestCalls[0]).toMatchObject({
      from: '2026-07-26T15:00:00.000Z',
      to: '2026-08-02T15:00:00.000Z',
    })
  })

  it('limit은 상한과 하한으로 잘린다', async () => {
    const { participants, service } = serviceAt('2026-08-05T03:00:00.000Z')

    await service.currentWeek(1000)
    await service.currentWeek(0)
    await service.currentWeek(-5)

    expect(participants.bestCalls.map((call) => call.limit)).toEqual([MAX_LIMIT, 1, 1])
  })

  /** 서비스는 정렬된 점수만 준다 — 순위 번호는 응답을 만들 때 붙는다. */
  it('행은 저장소가 준 순서 그대로 통과한다', async () => {
    const { participants, service } = serviceAt('2026-08-05T03:00:00.000Z')
    participants.rows = [
      { userId: 'u1', nickname: '일등', bestScore: 300 },
      { userId: 'u2', nickname: '이등', bestScore: 250 },
    ]

    expect((await service.currentWeek(100)).rows).toEqual(participants.rows)
  })

  /**
   * 랭킹은 야추만이다 — duel·pingpong은 보관은 되지만 잡히지 않는다
   * (persistence.md의 계약). 게임 코드가 REST 파라미터로 새지 않는지가 요점이다.
   */
  it('게임 코드는 YACHT_DICE로 고정된다', async () => {
    const { participants, service } = serviceAt('2026-08-05T03:00:00.000Z')
    participants.myBest = 100

    await service.currentWeek(100)
    await service.myCurrentWeek('me')

    expect(participants.bestCalls[0]?.gameCode).toBe(YACHT_DICE)
    expect(participants.myScoreCalls[0]?.gameCode).toBe(YACHT_DICE)
    expect(participants.countCalls[0]?.gameCode).toBe(YACHT_DICE)
  })

  describe('내 순위', () => {
    /** 내 순위 = 나보다 **높은** 점수의 회원 수 + 1. 목록의 1,2,2,4와 같은 체계다. */
    it('나보다 높은 점수의 회원 수 + 1이다', async () => {
      const { participants, service } = serviceAt('2026-08-05T03:00:00.000Z')
      participants.myBest = 100
      participants.better = 3

      expect(await service.myCurrentWeek('me')).toEqual({
        weekStart: '2026-08-03',
        rank: 4,
        bestScore: 100,
      })
      expect(participants.countCalls).toEqual([
        {
          gameCode: YACHT_DICE,
          score: 100,
          from: '2026-08-02T15:00:00.000Z',
          to: '2026-08-09T15:00:00.000Z',
        },
      ])
    })

    it('나보다 잘한 회원이 없으면 1위다', async () => {
      const { participants, service } = serviceAt('2026-08-05T03:00:00.000Z')
      participants.myBest = 300
      participants.better = 0

      expect(await service.myCurrentWeek('me')).toMatchObject({ rank: 1, bestScore: 300 })
    })

    /** 기록 없음은 0점과 다르다 — 0점은 순위에 오르지만 무기록은 오를 자리가 없다. */
    it('이번 주 기록이 없으면 undefined다(0점과 구분)', async () => {
      const { participants, service } = serviceAt('2026-08-05T03:00:00.000Z')
      participants.myBest = undefined

      expect(await service.myCurrentWeek('me')).toBeUndefined()
      // 최고점이 없으면 "나보다 잘한 사람"을 셀 이유도 없다.
      expect(participants.countCalls).toEqual([])
    })

    it('0점도 순위에 오른다', async () => {
      const { participants, service } = serviceAt('2026-08-05T03:00:00.000Z')
      participants.myBest = 0
      participants.better = 7

      expect(await service.myCurrentWeek('me')).toMatchObject({ rank: 8, bestScore: 0 })
    })

    it('내 최고점 조회도 같은 주 구간을 쓴다', async () => {
      const { participants, service } = serviceAt('2026-08-02T14:59:59.000Z')
      participants.myBest = 50

      await service.myCurrentWeek('me')

      expect(participants.myScoreCalls[0]).toMatchObject({
        userId: 'me',
        from: '2026-07-26T15:00:00.000Z',
        to: '2026-08-02T15:00:00.000Z',
      })
    })
  })
})
