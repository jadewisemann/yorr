import type { WeeklyBest, WeeklyRankingRepository } from './weeklyRankingStore.js'

/**
 * 주간 상위 목록 캐시.
 *
 * **Redis가 아니라 프로세스 인메모리다**(DESIGN.md 원칙 8). 캐시를 공유해야 하는
 * 상황은 인스턴스가 둘 이상일 때인데 이 앱은 이미 그럴 수 없다 — 라운드 상태·WS
 * 구독·타이머가 인메모리라 진행 중인 게임이 한 프로세스에 묶여 있다. 없는 제약을
 * 위해 직렬화 계층을 들이지 않는다. 재시작하면 통째로 비워지는데 이 값은 언제
 * 버려도 MySQL에서 다시 만들 수 있으므로 손실이 아니다.
 *
 * Java는 리포지토리 메서드에 애너테이션을 붙였다. Node에는 프록시가 없으니 같은
 * 자리를 **데코레이터**로 잡는다 — 서비스는 자기가 캐시를 보고 있는지 모른다.
 * 그래서 캐시를 끼우거나 빼도 서비스 테스트가 그대로 돈다.
 */

/**
 * 캐시 키 규약: `gameCode|from(UTC ISO)|limit`.
 *
 * - `from`(= 주 시작)이 키에 들어가므로 **주가 바뀌면 자연히 다른 항목**이다 —
 *   주 경계에서 지난 주 순위가 잠시 남아 보이는 경로가 없다.
 * - `limit`이 키에 들어가는 이유: 목록은 이미 잘린 결과다. `limit=10`의 값을
 *   `limit=100` 요청에 재사용하면 90명이 사라진다(Java도 `pageable.pageSize`를
 *   키에 넣는다).
 * - `gameCode`가 키에 들어가므로 같은 주라도 게임이 다르면 별도 항목이다.
 */
export const weeklyRankingCacheKey = (gameCode: string, from: Date, limit: number): string =>
  `${gameCode}|${from.toISOString()}|${limit}`

/**
 * 전적이 새로 쌓였음을 알리는 **좁은 포트**. 전적 보관(4.4)이 이것만 알면 되고,
 * 랭킹 캐시 구현이나 서비스 전체를 알 필요가 없다.
 *
 * Java의 `MatchArchiveService`에 붙은 `@CacheEvict(allEntries = true)` 자리다.
 */
export interface WeeklyRankingCacheEvictor {
  /** 항목 전체를 버린다. 주·게임·limit별로 골라 버리지 않는다(아래 주석). */
  evictAll(): void
}

/**
 * 상위 목록만 캐시하는 리포지토리 데코레이터.
 *
 * - **내 순위 질의는 캐시하지 않는다.** 사용자별 값이라 키에 회원이 들어가면
 *   항목이 회원 수만큼 늘어난다.
 * - **무효화는 전체 evict 하나뿐이다.** 랭킹이 바뀔 수 있는 시점은 판이 끝날
 *   때뿐이고(한 판이 10~30분) 그때마다 다시 세면 된다. 어떤 주·어떤 게임의
 *   항목이 더러워졌는지 계산하는 것보다 캐시 미스 한 번이 싸다.
 * - 같은 키에 대한 동시 요청은 둘 다 질의를 던진다(Java `ConcurrentMapCache`도
 *   `sync = false`가 기본이라 같다). 결과가 같으므로 나중 쓰기가 이겨도 무해하다.
 */
export class CachingWeeklyRankingRepository
  implements WeeklyRankingRepository, WeeklyRankingCacheEvictor
{
  private readonly entries = new Map<string, readonly WeeklyBest[]>()

  constructor(private readonly delegate: WeeklyRankingRepository) {}

  async findWeeklyBest(
    gameCode: string,
    from: Date,
    to: Date,
    limit: number,
  ): Promise<readonly WeeklyBest[]> {
    const key = weeklyRankingCacheKey(gameCode, from, limit)
    const cached = this.entries.get(key)
    // 빈 배열도 캐시된 값이다 — `undefined`(미스)와 구분한다. 아무도 없는 주에
    // 매 요청이 DB로 내려가면 주 시작 직후가 가장 비싸진다.
    if (cached !== undefined) return cached
    const rows = await this.delegate.findWeeklyBest(gameCode, from, to, limit)
    this.entries.set(key, rows)
    return rows
  }

  findWeeklyBestScoreOf(
    userId: string,
    gameCode: string,
    from: Date,
    to: Date,
  ): Promise<number | undefined> {
    return this.delegate.findWeeklyBestScoreOf(userId, gameCode, from, to)
  }

  countMembersScoringMoreThan(
    score: number,
    gameCode: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    return this.delegate.countMembersScoringMoreThan(score, gameCode, from, to)
  }

  evictAll(): void {
    this.entries.clear()
  }

  /** 테스트가 캐시가 실제로 걸렸는지 보는 창. 운영 코드는 쓰지 않는다. */
  get size(): number {
    return this.entries.size
  }
}
