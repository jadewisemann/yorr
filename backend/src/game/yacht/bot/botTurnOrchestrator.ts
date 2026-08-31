import {
  type DeadlineExecutor,
  type RoundStartedEvent,
  type RoundState,
  type ScheduledTimeout,
  timerDeadlineExecutor,
} from '../../round/index.js'
import type { YachtBroadcaster } from '../yachtPorts.js'
import { yachtWsType } from '../yachtWsTypes.js'
import type { BotTurnStep, YachtBotTurnCoordinator } from './yachtBotTurnCoordinator.js'

/**
 * 봇의 **연출 시계**.
 *
 * 라운드 타이머가 `round.start`를 방송할 때마다(같은 턴의 굴림마다 재전송된다) 이
 * 오케스트레이터가 깨어나, 활성자가 봇이면 지연을 두고 한 스텝을 실행한다. 지연이
 * 없으면 봇의 12라운드가 몇십 ms에 끝나 사람은 아무것도 못 본다.
 *
 * ## 지연 4종
 *
 * | 지연 | 값 | 무엇을 기다리는가 |
 * |---|---|---|
 * | 턴 시작 | 1200ms | "봇 차례입니다" 표시를 읽을 시간 |
 * | 굴림 관찰 | 6500ms | 주사위 애니메이션 + 결과를 보는 시간 |
 * | 킵 선택 후 | 1500ms | 킵된 주사위가 눈에 들어오는 시간 |
 * | 던지기 연출 | 600ms | `dice.broadcast` 뒤 `dice.thrown`까지 |
 *
 * ## 세대 가드
 *
 * 방마다 세대 카운터를 들고, 예약할 때의 세대와 발화 시점의 세대가 다르면 **아무것도
 * 하지 않는다.** 지연이 6.5초씩 되므로 그 사이에 턴이 넘어가는 일이 실제로 생긴다
 * (사람의 제출·마감 타임아웃·게임 종료). 코디네이터의 TurnVersion 검사와 **이중으로**
 * 막는 이유는 이쪽이 저장소를 읽지 않고 끊어 주기 때문이다.
 *
 * 주의: 봇이 굴리면 `YachtTurnActionService.roll` → `timers.start` → `onRoundStarted`로
 * 이 클래스가 **자기 안에서 다시 호출**되어 세대가 올라간다. 그래서 `dice.thrown`
 * 예약은 자기 세대가 아니라 **그때의 최신 세대**로 건다.
 */

export const TURN_START_DELAY_MS = 1_200
export const THROW_DELAY_MS = 600
export const ROLL_RESULT_DELAY_MS = 6_500
export const HOLD_SELECTION_DELAY_MS = 1_500

export interface BotTurnOrchestratorDeps {
  readonly coordinator: YachtBotTurnCoordinator
  readonly broadcaster: YachtBroadcaster
}

export interface BotTurnOrchestratorOptions {
  /**
   * 타이머 시임 — 마감 스케줄러가 같은
   * 이유로 둔 `DeadlineExecutor`를 그대로 재사용한다(요구되는 성질이 "지연 후 1회
   * 실행 + 취소"로 동일하고, 타이머 시임이 두 종류로 갈라지면 테스트 대역도 갈라진다).
   */
  readonly executor?: DeadlineExecutor
  readonly turnStartDelayMs?: number
  readonly rollResultDelayMs?: number
  readonly holdSelectionDelayMs?: number
  readonly throwDelayMs?: number
  readonly now?: () => number
  /** 경고 로그 훅. 봇 스텝의 예외는 여기로만 새어 나간다. */
  readonly onError?: (error: unknown, event: RoundStartedEvent) => void
}

export class BotTurnOrchestrator {
  private readonly coordinator: YachtBotTurnCoordinator
  private readonly broadcaster: YachtBroadcaster
  private readonly executor: DeadlineExecutor
  private readonly turnStartDelayMs: number
  private readonly rollResultDelayMs: number
  private readonly holdSelectionDelayMs: number
  private readonly throwDelayMs: number
  private readonly now: () => number
  private readonly onError: (error: unknown, event: RoundStartedEvent) => void

  /**
   * roomId → 최신 세대. Node는 단일 스레드라
   * 평범한 `Map`으로 충분하다(2.3이 세대 카운터에서 내린 같은 판단).
   */
  private readonly roomGenerations = new Map<string, number>()
  private readonly pending = new Set<ScheduledTimeout>()
  private sequence = 0

  constructor(deps: BotTurnOrchestratorDeps, options: BotTurnOrchestratorOptions = {}) {
    this.coordinator = deps.coordinator
    this.broadcaster = deps.broadcaster
    this.executor = options.executor ?? timerDeadlineExecutor()
    this.turnStartDelayMs = options.turnStartDelayMs ?? TURN_START_DELAY_MS
    this.rollResultDelayMs = options.rollResultDelayMs ?? ROLL_RESULT_DELAY_MS
    this.holdSelectionDelayMs = options.holdSelectionDelayMs ?? HOLD_SELECTION_DELAY_MS
    this.throwDelayMs = options.throwDelayMs ?? THROW_DELAY_MS
    this.now = options.now ?? Date.now
    this.onError = options.onError ?? (() => {})
  }

  /** `RoundTimerService`의 `onRoundStarted` 훅에 그대로 꽂는다. */
  onRoundStarted(event: RoundStartedEvent): void {
    this.sequence += 1
    const generation = this.sequence
    this.roomGenerations.set(event.roomId, generation)
    this.schedule(event, generation, this.delayFor(event.state))
  }

  /** 프로세스 종료·테스트 정리 — 남은 예약을 전부 취소한다. */
  stop(): void {
    for (const timeout of this.pending) timeout.cancel()
    this.pending.clear()
    this.roomGenerations.clear()
  }

  private delayFor(state: RoundState): number {
    // 굴림이 0회면 "턴이 막 시작됐다", 그 외는 "방금 굴린 결과를 보고 있다".
    return state.activeRollCount === 0 ? this.turnStartDelayMs : this.rollResultDelayMs
  }

  private schedule(event: RoundStartedEvent, generation: number, delayMs: number): void {
    this.run(() => this.executeIfLatest(event, generation), delayMs)
  }

  private run(task: () => void | Promise<void>, delayMs: number): void {
    const handle: { timeout: ScheduledTimeout | null } = { timeout: null }
    const timeout = this.executor.schedule(() => {
      if (handle.timeout !== null) this.pending.delete(handle.timeout)
      void Promise.resolve()
        .then(task)
        .catch(() => {
          // task 자체가 이미 삼킨다. 여기까지 오면 관측 훅이 던진 것이므로 무시한다.
        })
    }, delayMs)
    handle.timeout = timeout
    this.pending.add(timeout)
  }

  private async executeIfLatest(event: RoundStartedEvent, generation: number): Promise<void> {
    if (this.roomGenerations.get(event.roomId) !== generation) return
    try {
      const step = await this.coordinator.executeIfCurrent(event)
      if (isRollStep(event.state, step) && step.state !== null) {
        // 굴림이 성사되면 그 안에서 `timers.start`가 다시 `onRoundStarted`를 불러
        // 세대가 이미 올라가 있다. 그래서 자기 세대가 아니라 **최신 세대**로 예약한다 —
        // 자기 세대로 걸면 `dice.thrown`이 항상 스테일로 버려진다.
        const throwGeneration = this.roomGenerations.get(event.roomId)
        if (throwGeneration !== undefined) {
          this.scheduleThrow(event.roomId, step.state, throwGeneration)
        }
      }
      if (
        step.continueAfterObservation &&
        step.state !== null &&
        this.roomGenerations.get(event.roomId) === generation
      ) {
        // hold는 타이머를 다시 걸지 않으므로 세대가 그대로다 = 같은 턴을 이어간다.
        this.schedule(
          { roomId: event.roomId, state: step.state },
          generation,
          this.holdSelectionDelayMs,
        )
      }
    } catch (error) {
      // **삼키는 것이 계약이다.** 봇이 멈춰도 라운드 타이머(25s+1s)가 턴을 넘긴다 —
      // 봇 턴은 타이머 관점에서 절대 오프라인이 아니므로 게임이 막히지 않는다.
      this.onError(error, event)
    }
  }

  private scheduleThrow(roomId: string, rolled: RoundState, generation: number): void {
    this.run(() => this.announceThrowIfLatest(roomId, rolled, generation), this.throwDelayMs)
  }

  private announceThrowIfLatest(roomId: string, rolled: RoundState, generation: number): void {
    if (this.roomGenerations.get(roomId) !== generation) return
    try {
      // 봇은 `dice.thrown`만 내고 `dice.shaken`은 내지 않는다 — 흔들기는 사람의
      // 입력 연출이고, 봇에게는 대응하는 사건이 없다.
      this.broadcaster.broadcast(roomId, {
        type: yachtWsType('dice.thrown'),
        ts: this.now(),
        payload: {
          playerId: rolled.activePlayerId,
          roundNumber: rolled.roundNumber,
          rollCount: rolled.activeRollCount,
        },
        roomId,
        // msgId 없음 = 프론트가 "내 던지기"로 오인하지 않는다(사람 경로만 에코한다).
      })
    } catch (error) {
      this.onError(error, { roomId, state: rolled })
    }
  }
}

/**
 * 이 스텝이 **굴림**이었는가 — 같은 라운드·같은 활성자에서 rollCount가 정확히 1 늘었을 때.
 *
 * 제출 스텝은 굴림 전 상태를 그대로 돌려주므로 여기서 걸러진다(rollCount가 그대로다).
 * hold 스텝도 rollCount가 안 변한다. 그래서 `dice.thrown`은 굴림에만 붙는다.
 */
const isRollStep = (before: RoundState, step: BotTurnStep): boolean => {
  const after = step.state
  return (
    step.acted &&
    after !== null &&
    after.roundNumber === before.roundNumber &&
    after.activePlayerId === before.activePlayerId &&
    after.activeRollCount === before.activeRollCount + 1
  )
}
