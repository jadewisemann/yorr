import { describe, expect, it } from 'vitest'
import { KST_OFFSET_MINUTES, weekBoundaryOf } from '../weekBoundary.js'

/**
 * 이식: 의 경계 항목(초 단위) — 다만 저기서는
 * 서비스가 mock 리포지토리에 넘긴 값으로 관찰했고, 여기서는 경계 계산 자체를 직접
 * 본다. 서비스가 이 값을 그대로 넘기는지는 `weeklyRankingService.test.ts`가 본다.
 *
 * **MySQL·Redis 없이 도는 테스트다.** 4.5에서 가장 미묘한 것이 이 환산이므로
 * 게이트 뒤에 두면 안 된다 — skip된 초록은 검증이 아니다.
 *
 * 2026-08-03은 월요일이다.
 */
describe('주 경계 (KST 월요일 00:00 → UTC)', () => {
  const at = (utcInstant: string) => weekBoundaryOf(new Date(utcInstant))

  /** UTC 15:00 일요일 == KST 월요일 00:00 */
  it('월요일 0시 KST가 되는 순간부터 새 주를 센다', () => {
    const week = at('2026-08-02T15:00:00.000Z')

    expect(week.weekStart).toBe('2026-08-03')
    expect(week.from.toISOString()).toBe('2026-08-02T15:00:00.000Z')
    expect(week.to.toISOString()).toBe('2026-08-09T15:00:00.000Z')
  })

  /** UTC 14:59:59 일요일 == KST 일요일 23:59:59 */
  it('월요일 0시 KST 1초 전은 아직 지난 주다', () => {
    const week = at('2026-08-02T14:59:59.000Z')

    expect(week.weekStart).toBe('2026-07-27')
    expect(week.from.toISOString()).toBe('2026-07-26T15:00:00.000Z')
    expect(week.to.toISOString()).toBe('2026-08-02T15:00:00.000Z')
  })

  /** 1밀리초도 경계다 — `[from, to)`의 `from`은 포함, 그 직전은 지난 주. */
  it('경계는 밀리초까지 반개구간이다', () => {
    expect(at('2026-08-02T14:59:59.999Z').weekStart).toBe('2026-07-27')
    expect(at('2026-08-09T14:59:59.999Z').weekStart).toBe('2026-08-03')
    expect(at('2026-08-09T15:00:00.000Z').weekStart).toBe('2026-08-10')
  })

  /**
   * 서버가 UTC로 돌 때 가장 헷갈리는 자리: **UTC 달력으로는 아직 일요일인데 KST로는
   * 이미 월요일**인 구간(UTC 일 15:00~23:59). 여기서 지난 주를 돌려주면 월요일
   * 아침에 지난 주 순위가 보인다.
   */
  it('UTC 달력이 일요일이어도 KST가 월요일이면 새 주다', () => {
    const week = at('2026-08-02T23:30:00.000Z') // KST 2026-08-03(월) 08:30

    expect(week.weekStart).toBe('2026-08-03')
    expect(week.from.toISOString()).toBe('2026-08-02T15:00:00.000Z')
  })

  /** 월요일 당일이면 그 날 자신이 시작이다(`previousOrSame`). */
  it('주 안의 어느 시각이든 같은 경계를 낸다', () => {
    const boundaries = [
      '2026-08-02T15:00:00.000Z', // 월 00:00 KST
      '2026-08-05T03:00:00.000Z', // 수 12:00 KST
      '2026-08-09T14:59:59.999Z', // 일 23:59:59.999 KST
    ].map((instant) => at(instant))

    for (const week of boundaries) {
      expect(week.weekStart).toBe('2026-08-03')
      expect(week.from.toISOString()).toBe('2026-08-02T15:00:00.000Z')
      expect(week.to.toISOString()).toBe('2026-08-09T15:00:00.000Z')
    }
  })

  /** 달·해가 넘어가도 요일 계산이 흔들리지 않는지. */
  it('월·연 경계를 넘는 주도 같은 규칙이다', () => {
    // 2025-12-29(월) 00:00 KST == 2025-12-28T15:00Z. 이 주는 2026-01-04까지다.
    const newYear = at('2026-01-01T00:00:00.000Z') // KST 2026-01-01(목) 09:00

    expect(newYear.weekStart).toBe('2025-12-29')
    expect(newYear.from.toISOString()).toBe('2025-12-28T15:00:00.000Z')
    expect(newYear.to.toISOString()).toBe('2026-01-04T15:00:00.000Z')
  })

  /** 윤년 2월도 산술이 같다(Date.UTC가 정규화한다). */
  it('윤일을 포함한 주도 같은 규칙이다', () => {
    const leap = at('2028-02-29T00:00:00.000Z') // KST 2028-02-29(화) 09:00

    expect(leap.weekStart).toBe('2028-02-28')
    expect(leap.from.toISOString()).toBe('2028-02-27T15:00:00.000Z')
  })

  /**
   * **+9 고정이라는 판단의 감시 장치**(weekBoundary.ts 상단 주석).
   *
   * 한국은 서머타임을 쓰지 않으므로 이 계산 범위에서 `Asia/Seoul`의 오프셋은 항상
   * +09:00 하나다. 그 전제가 tzdata 변경으로 깨지면 여기서 먼저 깨진다 — 랭킹이
   * 주 경계에서만 조용히 틀리는 것보다 훨씬 낫다.
   */
  it('Asia/Seoul의 실제 오프셋은 앞으로도 +9 하나다', () => {
    const offsets = new Set<number>()
    for (let year = 2026; year <= 2029; year += 1) {
      for (let month = 0; month < 12; month += 1) {
        // 각 달의 1일·15일 — 서머타임 전환은 늘 이 사이에 걸린다.
        offsets.add(seoulOffsetMinutes(new Date(Date.UTC(year, month, 1))))
        offsets.add(seoulOffsetMinutes(new Date(Date.UTC(year, month, 15))))
      }
    }

    expect([...offsets]).toEqual([KST_OFFSET_MINUTES])
  })

  /** 위 감시 장치가 실제로 시간대 DB를 읽고 있음을 확인한다(ICU 없는 빌드 방어). */
  it('감시 장치가 시간대 DB를 실제로 읽는다', () => {
    // UTC와 다른 값이 나와야 `Intl`이 존을 무시하고 UTC로 답한 게 아니다.
    expect(seoulOffsetMinutes(new Date('2026-08-14T00:00:00Z'))).not.toBe(0)
  })
})

/** `at`이라는 순간의 서울 벽시계와 UTC 벽시계의 차(분). tzdata를 읽는 유일한 경로다. */
const seoulOffsetMinutes = (at: Date): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const field = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value)
  const wallClock = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second'),
  )
  return (wallClock - Math.floor(at.getTime() / 1000) * 1000) / 60_000
}
