/**
 * 라운드 마감 예약. 방 하나당 예약은 **하나**이고, 다시 예약하면 세대가 바뀌어
 * 앞의 예약은 무효가 된다.
 */
export interface RoundDeadlineScheduler {
  /** @param deadline 마감 시각(Date 또는 epoch ms). 이미 지났으면 지연 0으로 발화한다. */
  schedule(
    roomId: string,
    roundNumber: number,
    deadline: Date | number,
    timeoutAction: () => void | Promise<void>,
  ): void

  /** 라운드 번호가 **일치할 때만** 취소한다(다음 턴 예약을 실수로 지우지 않게). */
  cancel(roomId: string, roundNumber: number): void

  /** 방의 예약을 무조건 취소한다(게임 종료·방 폐쇄). */
  cancelRoom(roomId: string): void
}

/** 예약 하나의 핸들. */
export interface ScheduledTimeout {
  cancel(): void
}

/**
 * 타이머 주입 시임.
 *
 * 이게 없으면 "슬롯 선등록" 규칙(아래 schedule 주석)을 검증할 수 없다: 그
 * 회귀 테스트는 **schedule()이 반환하기 전에** 작업이 실행되는 인터리빙을
 * 재현해야 하는데, `vi.useFakeTimers()`로는 그 순간을 만들 수 없다(가짜 타이머도
 * advance 시점에만 콜백을 부른다). 인라인 실행 executor를 넣으면 최악의 순서가
 * 결정적으로 재현되고, 테스트가 실시간 sleep에 기대지 않는다.
 */
export interface DeadlineExecutor {
  schedule(task: () => void, delayMs: number): ScheduledTimeout
}

/** 운영 기본값. Node 타이머는 `unref`해 이벤트 루프를 붙잡지 않는다. */
export const timerDeadlineExecutor = (): DeadlineExecutor => ({
  schedule(task, delayMs) {
    const timer = setTimeout(task, delayMs)
    timer.unref()
    return {
      cancel: () => clearTimeout(timer),
    }
  },
})

interface ScheduledRound {
  readonly roundNumber: number
  readonly generation: number
  /** 슬롯을 먼저 잡는 구간에서만 잠깐 null이다(schedule 주석 참고). */
  timeout: ScheduledTimeout | null
}

export interface RoundDeadlineSchedulerOptions {
  readonly executor?: DeadlineExecutor
  readonly now?: () => number
  /** 마감 작업이 던지면 여기로 온다 — 예약기는 살아남는다. */
  readonly onError?: (error: unknown, roomId: string) => void
}

/**
 * 단일 인스턴스 전제 어댑터.
 *
 * Node는 단일 스레드라 세대 카운터는 평범한 숫자, 맵은 평범한 `Map`으로 충분하다
 * — 전이가 모두 동기라 사이에 다른 콜백이 끼어들 수 없다.
 */
export class InMemoryRoundDeadlineScheduler implements RoundDeadlineScheduler {
  private readonly scheduledRounds = new Map<string, ScheduledRound>()
  private readonly executor: DeadlineExecutor
  private readonly now: () => number
  private readonly onError: (error: unknown, roomId: string) => void
  private generations = 0

  constructor(options: RoundDeadlineSchedulerOptions = {}) {
    this.executor = options.executor ?? timerDeadlineExecutor()
    this.now = options.now ?? Date.now
    this.onError = options.onError ?? (() => {})
  }

  schedule(
    roomId: string,
    roundNumber: number,
    deadline: Date | number,
    timeoutAction: () => void | Promise<void>,
  ): void {
    if (roomId.trim().length === 0) throw new Error('roomId must not be blank')
    if (roundNumber < 1) throw new Error('roundNumber must be at least 1')

    const deadlineMs = deadline instanceof Date ? deadline.getTime() : deadline
    const delayMs = Math.max(0, deadlineMs - this.now())
    this.generations += 1
    const generation = this.generations

    // 슬롯을 예약보다 **먼저** 잡는다. 마감이 이미 지났으면(delayMs === 0) 워커가
    // 아래 executor.schedule 직후 바로 실행되는데, 그때 이 세대가 맵에 없으면
    // runIfCurrent가 "내 차례가 아니다"로 조용히 스킵한다 → 그 방은 다음
    // schedule까지 타임아웃이 영영 안 온다(탁구: 서브·실점이 멈추고 공이 얼어붙음).
    //
    // Node의 setTimeout은 스레드가 없어 이 인터리빙이 실제로 생기지 않지만,
    // executor가 주입 가능한 시임인 이상(인라인 executor·향후 다른 어댑터)
    // 순서 자체가 계약이다(실제 레이스로 한 번 깨졌던 규칙이다).
    const previous = this.scheduledRounds.get(roomId)
    this.scheduledRounds.set(roomId, { roundNumber, generation, timeout: null })
    cancelQuietly(previous)

    const timeout = this.executor.schedule(
      () => this.runIfCurrent(roomId, roundNumber, generation, timeoutAction),
      delayMs,
    )
    // 이미 실행돼 슬롯이 비었거나 다른 세대로 바뀌었으면 붙일 곳이 없다(앞선
    // computeIfPresent no-op 자리). 그 핸들은 버려도 runIfCurrent가 세대로 막는다.
    const slot = this.scheduledRounds.get(roomId)
    if (slot !== undefined && slot.generation === generation) slot.timeout = timeout
  }

  cancel(roomId: string, roundNumber: number): void {
    const scheduled = this.scheduledRounds.get(roomId)
    if (scheduled === undefined || scheduled.roundNumber !== roundNumber) return
    cancelQuietly(scheduled)
    this.scheduledRounds.delete(roomId)
  }

  cancelRoom(roomId: string): void {
    const scheduled = this.scheduledRounds.get(roomId)
    if (scheduled === undefined) return
    this.scheduledRounds.delete(roomId)
    cancelQuietly(scheduled)
  }

  /** 프로세스 종료 정리 — 걸린 예약을 전부 끊는다. */
  stop(): void {
    for (const scheduled of this.scheduledRounds.values()) cancelQuietly(scheduled)
    this.scheduledRounds.clear()
  }

  private runIfCurrent(
    roomId: string,
    roundNumber: number,
    generation: number,
    timeoutAction: () => void | Promise<void>,
  ): void {
    const scheduled = this.scheduledRounds.get(roomId)
    if (
      scheduled === undefined ||
      scheduled.roundNumber !== roundNumber ||
      scheduled.generation !== generation
    ) {
      return
    }
    this.scheduledRounds.delete(roomId)
    void (async () => {
      try {
        await timeoutAction()
      } catch (error) {
        this.onError(error, roomId)
      }
    })()
  }
}

const cancelQuietly = (scheduled: ScheduledRound | undefined): void => {
  scheduled?.timeout?.cancel()
}
