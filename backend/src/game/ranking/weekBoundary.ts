/**
 * 주간 랭킹의 주 경계 — **KST 월요일 00:00**.
 *
 * 이 파일이 4.5의 유일하게 미묘한 지점이다. 경계가 어긋나면 주가 바뀌는 순간에만
 * 틀리므로 굴려서는 잡히지 않는다(Java `WeeklyRankingServiceTest`가 초 단위로
 * 못박아 둔 이유).
 *
 * ## 왜 존을 코드에 고정하는가
 * Java는 `ZoneId.of("Asia/Seoul")`을 상수로 박았다. 인프라의 `TZ` 환경변수에
 * 맡기면 개발 컨테이너(Asia/Seoul)와 운영(UTC)이 서로 다른 주를 세게 된다 —
 * `infra/mysql.ts`가 `timezone: 'Z'`로 막아 둔 것과 **같은 종류의 스큐**다.
 *
 * ## 왜 시간대 DB(`Intl`) 대신 +9 고정인가
 * 이 계산에 들어오는 시각은 "지금"과 "지금 + 7일"뿐이다. 대한민국은 현재
 * 서머타임을 쓰지 않고(마지막 시행 1988년, 그 이전의 +08:30 구간은 1961년까지다)
 * 따라서 이 범위에서 `Asia/Seoul`의 오프셋은 항상 +09:00 하나다. 즉 시간대 DB를
 * 끌어와도 얻는 값이 같다.
 *
 * 그래서 얻는 것: 오프셋 계산이 산술 한 줄이라 Node의 ICU 빌드(`full-icu` 여부)나
 * 컨테이너의 tzdata 버전에 결과가 걸리지 않는다. 대가는 "언젠가 한국이 서머타임을
 * 되살리면 틀린다"인데, 그건 조용히 틀리지 않는다 — `__tests__/weekBoundary.test.ts`가
 * `Intl`의 `Asia/Seoul`과 이 상수를 앞으로 3년치 대조하므로 tzdata가 바뀌는 순간
 * 테스트가 먼저 깨진다.
 */

/** `Asia/Seoul`의 UTC 오프셋(분). 위 주석의 판단이 이 상수 하나에 걸려 있다. */
export const KST_OFFSET_MINUTES = 9 * 60

const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE
const KST_OFFSET_MS = KST_OFFSET_MINUTES * MS_PER_MINUTE

export interface WeekBoundary {
  /**
   * 이 주가 시작하는 **KST 달력 날짜**(`YYYY-MM-DD`). Java `LocalDate`가
   * 직렬화되는 모양 그대로다 — 프론트의 "이번 주" 표기를 서버 기준으로 맞추려면
   * 순위와 함께 나가야 한다(`frontend/src/shared/api/rankingApi.ts`).
   */
  readonly weekStart: string
  /** 포함. KST 월요일 00:00을 가리키는 순간(== 일요일 15:00 UTC). */
  readonly from: Date
  /** 제외. 다음 주 시작. */
  readonly to: Date
}

/**
 * `at`이 속한 주의 경계. 월요일 당일이면 그 날 00:00 자신이 시작이고,
 * 00:00 정각은 **새 주에 속한다**(반개구간 `[from, to)`).
 *
 * 돌려주는 `from`·`to`는 순간(`Date`)이다. 풀이 `timezone: 'Z'`이므로 그대로
 * `finished_at DATETIME(6)`(UTC 벽시계)과 비교된다 — Java가 `LocalDateTime`으로
 * 환산해 넘기는 것과 같은 값이 SQL에 실린다.
 */
export const weekBoundaryOf = (at: Date): WeekBoundary => {
  // KST 벽시계를 UTC 게터로 읽기 위해 오프셋만큼 옮긴 값. 이 시각의 `getUTC*`가
  // 곧 서울의 연·월·일·요일이다.
  const kst = new Date(at.getTime() + KST_OFFSET_MS)
  // JS는 일요일이 0이다. 월요일 기준 주라 하루를 뒤로 밀어 센다(월=0 … 일=6).
  const daysSinceMonday = (kst.getUTCDay() + 6) % 7
  const kstWeekStartWallClock =
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) -
    daysSinceMonday * MS_PER_DAY
  const from = new Date(kstWeekStartWallClock - KST_OFFSET_MS)
  return {
    weekStart: new Date(kstWeekStartWallClock).toISOString().slice(0, 10),
    from,
    // 오프셋이 고정이라(위 주석) 7일 = 정확히 7 × 24시간이다.
    to: new Date(from.getTime() + 7 * MS_PER_DAY),
  }
}
