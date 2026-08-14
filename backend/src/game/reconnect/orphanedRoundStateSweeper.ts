import type {
  OrphanedRoundStatePort,
  RoundTimerCancelPort,
  SweeperRoomService,
} from './reconnectPorts.js'

/**
 * 스윕 주기. 이 값이 회수 지연의 상한이다 — 방 TTL(40분)보다 충분히 짧으면 되고,
 * 짧게 잡을 이유도 없다(항목 하나가 수 KB 수준이라 몇 분 더 남아도 무해하고, 한
 * 주기마다 상태 키 SCAN이 한 번 돈다).
 */
export const SWEEP_INTERVAL_MS = 5 * 60 * 1000

/** 주기 실행 핸들. Java `ScheduledFuture` 자리. */
export interface SweepSchedule {
  stop(): void
}

/**
 * 주기 실행 주입 시임 — Java의 `@Scheduled(fixedDelay=…, initialDelay=…)` 자리다.
 *
 * 이게 없으면 스윕 테스트가 실시간 sleep(5분!)에 기대야 한다. 시임을 두면
 * 테스트가 `sweep()`을 직접 부르거나 가짜 스케줄러의 작업을 직접 발화시켜
 * 결정적으로 검증한다(2.3 `DeadlineExecutor`와 같은 이유·같은 모양).
 */
export interface SweepScheduler {
  /** @param task 첫 실행은 `intervalMs` **뒤**다(Java의 initialDelay = 주기). */
  every(intervalMs: number, task: () => void): SweepSchedule
}

/** 운영 기본값. Node 타이머는 `unref`해 이벤트 루프를 붙잡지 않는다. */
export const timerSweepScheduler = (): SweepScheduler => ({
  every(intervalMs, task) {
    const timer = setInterval(task, intervalMs)
    timer.unref()
    return { stop: () => clearInterval(timer) }
  },
})

export interface OrphanedRoundStateSweeperDeps {
  readonly roundStates: OrphanedRoundStatePort
  readonly timers: RoundTimerCancelPort
  readonly rooms: SweeperRoomService
}

export interface OrphanedRoundStateSweeperOptions {
  readonly intervalMs?: number
  readonly scheduler?: SweepScheduler
  /** 회수 관측 훅(Java `log.info`). */
  readonly onSwept?: (roomId: string) => void
  /** 주기 실행이 던졌을 때(Java: Spring이 로그만 남기고 다음 주기에 재시도). */
  readonly onError?: (error: unknown) => void
}

/**
 * 방이 사라졌는데도 남아 있는 라운드 상태를 주기적으로 걷어낸다 — backend-java
 * `OrphanedRoundStateSweeper`.
 *
 * **왜 필요한가:** 라운드 상태는 Redis에 있어 TTL로 스스로 사라지지만, 거기 딸린
 * 인메모리 자원(마감 타이머 예약 · 오프라인 결석 카운트)은 TTL이 청소해주지 않는다.
 * 그것들을 회수하는 경로는 빈 방 유예 타이머 하나뿐인데, 그 예약은 프로세스가
 * 재시작되면 사라진다. 그러면 방이 없어진 뒤에도 남은 상태와 예약을 아무도 치우지
 * 않는다.
 *
 * **왜 타이머 대신 스윕인가:** 예약이 유실·경합으로 날아가도 다음 주기에 복구되고,
 * Redis TTL 만료를 자동으로 따라간다(keyspace notification에 의존하지 않는다 —
 * 그쪽은 at-most-once라 이벤트가 유실될 수 있다). 유예 타이머는 "빠른 회수"
 * 최적화로 남고, 정확성은 이 스윕이 받친다.
 */
export class OrphanedRoundStateSweeper {
  private readonly roundStates: OrphanedRoundStatePort
  private readonly timers: RoundTimerCancelPort
  private readonly rooms: SweeperRoomService
  private readonly intervalMs: number
  private readonly scheduler: SweepScheduler
  private readonly onSwept: (roomId: string) => void
  private readonly onError: (error: unknown) => void

  private schedule: SweepSchedule | null = null

  constructor(deps: OrphanedRoundStateSweeperDeps, options: OrphanedRoundStateSweeperOptions = {}) {
    this.roundStates = deps.roundStates
    this.timers = deps.timers
    this.rooms = deps.rooms
    this.intervalMs = options.intervalMs ?? SWEEP_INTERVAL_MS
    this.scheduler = options.scheduler ?? timerSweepScheduler()
    this.onSwept = options.onSwept ?? (() => {})
    this.onError = options.onError ?? (() => {})
  }

  /**
   * 주기 실행을 건다. **멱등** — 이미 돌고 있으면 아무것도 하지 않는다(배선이
   * 두 번 불러도 스윕이 두 배로 돌지 않게).
   */
  start(): void {
    if (this.schedule !== null) return
    this.schedule = this.scheduler.every(this.intervalMs, () => {
      // 한 주기가 던져도 예약은 살아남아야 한다 — Spring `@Scheduled`가 예외를
      // 로그로 흘리고 다음 주기에 재시도하는 것과 같은 결과.
      void this.sweep().catch((error: unknown) => this.onError(error))
    })
  }

  /** 프로세스 종료 정리. 멱등이다. */
  stop(): void {
    this.schedule?.stop()
    this.schedule = null
  }

  /**
   * 한 주기를 지금 실행한다.
   *
   * @returns 이번 주기에 걷어낸 방 수.
   */
  async sweep(): Promise<number> {
    let swept = 0
    // roomIds()는 복사본이다 — 순회 중 remove를 부르므로 살아있는 키 집합을 돌면 안 된다.
    for (const roomId of await this.roundStates.roomIds()) {
      const room = await this.rooms.getSnapshot(roomId)
      // 없는 방은 `phase: null` 스냅샷이다(room/snapshot.ts `roomNotFound`).
      if (room !== null && room.phase !== null) continue

      // ⚠️ 순서가 계약이다: 타이머를 **먼저** 끊어야 방 없는 상태로 마감이 발화하지
      // 않는다. 뒤집으면 이미 지운 방의 마감 작업이 라운드 상태를 다시 만든다.
      this.timers.cancelRoom(roomId)
      await this.roundStates.remove(roomId)
      swept += 1
      this.onSwept(roomId)
    }
    return swept
  }
}
