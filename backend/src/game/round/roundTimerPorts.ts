import type { RoundDeadlineScheduler } from './deadlineScheduler.js'
import type { RoundDeadlineStore } from './deadlineStore.js'
import type {
  GameCompletionPort,
  RoundBroadcaster,
  RoundPresence,
  RoundRoomService,
  ScoreRoundSubmissionOutcome,
} from './roundPorts.js'
import type { RoundState, RoundSubmissionResult } from './roundState.js'
import type { RoundSynchronizationService } from './roundSynchronizationService.js'
import type { RoundTimeoutResolverPort } from './roundTimeoutResolver.js'

/**
 * 턴 시계의 입출력 계약 — `RoundTimerService`의 생성자 인자와 관측 훅.
 *
 * 왜 분리했나: 이 인터페이스는 "무엇을 받아야 하는가"를 말하고, 클래스는 "언제 무엇을
 * 하는가"를 말한다. 주석이 긴 쪽은 전자라서, 규칙을 확인할 때 클래스 본문을 열지
 * 않아도 되게 한다.
 */

/** 봇 오케스트레이터(3.2)가 구독하는 턴 시작 알림. */
export interface RoundStartedEvent {
  readonly roomId: string
  readonly state: RoundState
}

/** 타이머가 `advanceTurn`으로 받는 것. 타임아웃 경로는 `score: null`로 들어온다. */
export type TurnAdvanceInput = ScoreRoundSubmissionOutcome<RoundSubmissionResult>

export interface RoundTimerServiceDeps {
  readonly timeoutResolver: RoundTimeoutResolverPort
  readonly deadlineScheduler: RoundDeadlineScheduler
  /**
   * 마감 시각의 **영속 사본**(PR 6). 예약기가 인메모리인 것은 그대로다 —
   * 여기 저장되는 것은 "언제 마감인가"라는 데이터이고, 발화 책임은 여전히 이
   * 프로세스에 있다(DESIGN.md 원칙 8).
   *
   * ⚠️ 운영은 `RedisRoundDeadlineStore`다. `InMemoryRoundDeadlineStore`를 넣어도
   * 타입이 맞고 테스트가 전부 통과하지만, 그 순간 재시작마다 진행 중 게임이 사라지는
   * 예전 동작으로 조용히 돌아간다.
   */
  readonly deadlineStore: RoundDeadlineStore
  readonly broadcaster: RoundBroadcaster
  readonly gameCompletion: GameCompletionPort
  readonly synchronizationService: RoundSynchronizationService
  readonly presence: RoundPresence
  readonly roomService: RoundRoomService
}

export interface RoundTimerServiceOptions {
  readonly now?: () => number
  readonly gameCode?: string
  /** 라운드 시작을 알리는 훅. */
  readonly onRoundStarted?: (event: RoundStartedEvent) => void
  /** 종료 전이 실패처럼 "진행은 멈추지만 예외는 아닌" 상황의 관측 훅. */
  readonly onWarning?: (roomId: string, reason: string) => void
}
