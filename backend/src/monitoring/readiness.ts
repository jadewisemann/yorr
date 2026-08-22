/**
 * Readiness 판정 — `/actuator/health`가 뜻하는 것을 "프로세스가 HTTP를 받는다"에서
 * **"이 인스턴스가 실제 요청을 처리할 준비가 되었다"**로 올린다
 * ([`deploy/PLAN.md`](../../../deploy/PLAN.md) PR 1).
 *
 * 이 한 곳을 고치면 세 소비자가 함께 올라간다: 이미지의 `HEALTHCHECK`
 * (`backend/Dockerfile`), 배포 게이트(`docker compose up -d --wait`), 그리고 호스트
 * 밖의 외부 uptime 체크. 그래서 배포 재설계에서 이것이 선행 조건이다 — `--wait`는
 * 자기가 기다리는 health가 진짜가 아니면 crash 루프를 성공으로 읽는다.
 *
 * 응답 형식은 바꾸지 않는다: 준비됐으면 200 `{"status":"UP"}`, 아니면 503
 * `{"status":"DOWN"}`이다. **어느 의존이 죽었는지는 본문에 싣지 않는다** — 인증 없이
 * 공개되는 표면이므로 토폴로지를 흘리지 않고, 진단은 로그로 남긴다(라우트 배선이
 * `onChanged`로 받는다).
 */

/** 기본 캐시 창. 컨테이너 `HEALTHCHECK`는 30초마다, 배포 게이트는 더 자주 두드린다. */
export const READINESS_CACHE_MS = 5_000

/**
 * 확인 하나에 주는 시간.
 *
 * 상한이 필요한 이유는 성능이 아니라 **의미**다. ioredis는 오프라인 큐가 기본값이라
 * Redis가 죽어 있으면 `ping()`이 거부되지 않고 **큐에 쌓여 매달린다**. 상한이 없으면
 * 그 요청은 영원히 대기하고, 컨테이너 `HEALTHCHECK`는 자기 타임아웃(5초)으로 잘려
 * "판정 없음"이 된다. 여기서 끊으면 같은 상황이 **명시적인 DOWN**이 된다.
 */
export const READINESS_TIMEOUT_MS = 2_000

/** 확인 하나. 거부하거나 던지면 준비되지 않은 것으로 본다. */
export interface ReadinessCheck {
  /** 로그·진단용 이름. **응답 본문에는 나가지 않는다.** */
  readonly name: string
  run(): Promise<unknown> | unknown
}

export interface ReadinessFailure {
  readonly name: string
  readonly reason: unknown
}

export interface ReadinessResult {
  readonly ready: boolean
  /** 준비됐으면 빈 배열이다. 순서는 확인을 등록한 순서다. */
  readonly failures: readonly ReadinessFailure[]
}

/** 라우트가 실제로 요구하는 것만(`http/routes/health.ts`가 이 포트로 받는다). */
export interface ReadinessPort {
  check(): Promise<ReadinessResult>
}

export interface ReadinessServiceOptions {
  readonly cacheMs?: number
  readonly timeoutMs?: number
  readonly now?: () => number
  /**
   * 판정이 **바뀔 때만** 부른다(첫 판정도 변화로 본다).
   *
   * 매 확인마다 부르지 않는 이유: 죽은 채로 오래 있으면 같은 줄이 30초마다 쌓여
   * 정작 전이 시점을 찾기 어려워진다. 운영이 알고 싶은 것은 "언제 죽고 언제
   * 돌아왔는가"라는 이진 사건이다(PLAN.md §10과 같은 판단).
   */
  readonly onChanged?: (result: ReadinessResult) => void
}

/**
 * 확인들을 모아 하나의 판정으로 만든다.
 *
 * 캐시와 in-flight 공유가 둘 다 있는 이유가 다르다. 캐시는 **반복 호출**을 흡수하고
 * (`HEALTHCHECK` · 외부 체크 · 배포 게이트가 각자 주기로 두드린다), in-flight 공유는
 * **동시 호출**을 흡수한다 — 캐시만 있으면 창이 만료된 순간 도착한 요청 여럿이
 * 나란히 Redis·MySQL 왕복을 낸다.
 */
export class ReadinessService implements ReadinessPort {
  private readonly checks: readonly ReadinessCheck[]
  private readonly cacheMs: number
  private readonly timeoutMs: number
  private readonly now: () => number
  private readonly onChanged: (result: ReadinessResult) => void

  private cached: { readonly at: number; readonly result: ReadinessResult } | null = null
  private inFlight: Promise<ReadinessResult> | null = null

  constructor(checks: readonly ReadinessCheck[], options: ReadinessServiceOptions = {}) {
    this.checks = [...checks]
    this.cacheMs = options.cacheMs ?? READINESS_CACHE_MS
    this.timeoutMs = options.timeoutMs ?? READINESS_TIMEOUT_MS
    this.now = options.now ?? Date.now
    this.onChanged = options.onChanged ?? (() => {})
  }

  async check(): Promise<ReadinessResult> {
    const cached = this.cached
    if (cached !== null && this.now() - cached.at < this.cacheMs) return cached.result
    // 실패도 같은 창만큼 캐시한다. 회복 감지가 최대 cacheMs만큼 늦지만, 그 대가로
    // 죽어 있는 동안의 왕복이 유계가 된다 — 이 엔드포인트는 프록시를 통해 공개된다.
    this.inFlight ??= this.runAll().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async runAll(): Promise<ReadinessResult> {
    // 순차가 아니라 동시에 던진다 — 판정 지연이 두 왕복의 합이 아니라 최댓값이 된다.
    const outcomes = await Promise.all(
      this.checks.map(async (check): Promise<ReadinessFailure | null> => {
        try {
          await runWithTimeout(check, this.timeoutMs)
          return null
        } catch (reason) {
          return { name: check.name, reason }
        }
      }),
    )
    const failures = outcomes.filter((outcome): outcome is ReadinessFailure => outcome !== null)
    const result: ReadinessResult = { ready: failures.length === 0, failures }

    const previous = this.cached?.result.ready
    this.cached = { at: this.now(), result }
    if (previous !== result.ready) this.onChanged(result)
    return result
  }
}

const runWithTimeout = async (check: ReadinessCheck, timeoutMs: number): Promise<void> => {
  let timer: NodeJS.Timeout | undefined
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${check.name} 확인이 ${timeoutMs}ms 안에 끝나지 않았습니다`)),
      timeoutMs,
    )
    // 이벤트 루프를 붙잡지 않는다(마감 스케줄러의 타이머와 같은 규약).
    timer.unref()
  })
  try {
    await Promise.race([Promise.resolve(check.run()), expiry])
  } finally {
    clearTimeout(timer)
  }
}

/** `ioredis`의 `Redis`가 그대로 만족한다. 이 판정이 실제로 부르는 것은 `ping` 하나다. */
export interface ReadinessRedis {
  ping(): Promise<unknown>
}

/**
 * Redis는 **게임의 필수 의존**이다 — 방·세션·진행 중 게임 상태·점수판이 전부 여기 있다
 * (docs/design/persistence.md). 죽어 있으면 이 인스턴스는 아무것도 처리할 수 없다.
 */
export const redisReadinessCheck = (redis: ReadinessRedis): ReadinessCheck => ({
  name: 'redis',
  run: () => redis.ping(),
})

/** `mysql2/promise`의 `Pool`이 그대로 만족한다. */
export interface ReadinessMysql {
  query(sql: string): Promise<unknown>
}

/**
 * MySQL은 계정·소셜 연동·전적·주간 랭킹을 담는다. 진행 중인 게임은 MySQL 없이도
 * 굴러가지만(상태가 Redis에 있다) **로그인과 랭킹은 즉시 실패한다.** 그래서 여기서는
 * DOWN으로 본다: readiness는 "게임이 안 끊겼다"가 아니라 "이 인스턴스가 자기 계약을
 * 전부 이행할 수 있다"는 뜻이다.
 *
 * 배포가 이 판정 때문에 막히지는 않는다. 새 릴리스가 못 뜨는 것과 인프라가 죽은 것은
 * 다른 사건이므로 controller의 preflight가 둘을 나눠 다룬다(PLAN.md D6).
 */
export const mysqlReadinessCheck = (mysql: ReadinessMysql): ReadinessCheck => ({
  name: 'mysql',
  run: () => mysql.query('SELECT 1'),
})
