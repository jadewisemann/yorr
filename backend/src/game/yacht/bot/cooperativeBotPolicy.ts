import type { ScoreBoard } from '../../score/index.js'
import { BotDecisionError, BotQueueFullError } from './botErrors.js'
import type { YachtBotPolicy } from './botPorts.js'
import type { BotDecision } from './expectimaxYachtBotPolicy.js'

/**
 * 봇 탐색을 **프로세스 전체에서 한 번에 하나씩**, 사이사이 이벤트 루프에 양보하며 돌린다.
 *
 * 왜 필요한가: 오케스트레이터는 봇 스텝마다 `setTimeout`을 건다. 여러 방의 봇 턴이 같은 시점에
 * 만료되면 Node는 **timers 단계에서 만료된 타이머를 전부 실행한 뒤에야** poll 단계(소켓 I/O)로
 * 넘어간다. 그래서 탐색 N개가 연달아 돌고, 그동안 관계없는 방의 메시지·하트비트가 전부 기다린다
 * — "타이머가 따로라 사이에 I/O가 끼어든다"는 예전 설계 문서의 가정은 틀렸다. 실측(별도 프로세스
 * 클라이언트, 30ms 탐색 10개 동시 만료): 왕복 최대 271ms → 이 큐로 29ms.
 *
 * 그래서 탐색을 큐에 넣고, 앞의 탐색이 끝난 뒤 `setImmediate`로 한 바퀴 양보하고 나서 다음을
 * 돌린다. `setImmediate`는 check 단계에서 돌고, 그 안에서 새로 건 것은 **다음 바퀴**로 미뤄지므로
 * 탐색 사이마다 poll 단계가 한 번씩 끼어든다. 이벤트 루프를 막는 단위가 "탐색 N개"에서
 * "탐색 하나"(예산 250ms가 상한)로 줄어든다.
 *
 * worker 스레드를 쓰지 않는 이유: 배포 대상이 0.5 vCore라 CPU를 늘려 주지 못하고, 워커 하나가
 * 메모리 수십 MB와 수명·오류 전파·테스트 대역을 더한다. 막히는 길이를 줄이는 것은 이 큐로 충분하다.
 *
 * 한 탐색의 실패는 그 호출만 거절한다 — 큐는 다음 탐색으로 계속 간다(코디네이터가 폴백한다).
 *
 * **대기에는 상한이 있다**(`maxQueued`, 기본 8). 예산은 탐색 하나의 시간만 묶으므로, 줄이 길면 뒤쪽
 * 봇은 탐색을 시작하기도 전에 수백 ms를 기다린다. 상한을 넘으면 기다리지 않고 `BotQueueFullError`로
 * 즉시 거절해 그 봇은 폴백 전략(마이크로초급)으로 둔다. 기다리는 동안 상태가 바뀌는 경우는
 * 코디네이터가 결정 뒤에 턴을 다시 읽어 막는다.
 */
export const DEFAULT_MAX_QUEUED_SEARCHES = 8

/**
 * 탐색 하나가 이 시간 안에 settle되지 않으면 그 호출을 거절하고 큐를 푼다.
 *
 * 큐는 포트 뒤에 **비동기·외부 실행 구현**이 올 수 있게 설계됐다. 그런 구현이 죽은 워커
 * 등으로 영영 settle되지 않으면 `pending`이 회수되지 않아, 상한(8)개가 그렇게 되면 이후
 * **모든 방의 봇**이 조용히 폴백으로만 돈다. 정상 예산(기본 250ms)보다 넉넉히 잡아
 * 정상 탐색을 자르지 않으면서 마지막 회수 수단이 된다.
 */
export const DEFAULT_SETTLE_TIMEOUT_MS = 60_000

export class CooperativeYachtBotPolicy implements YachtBotPolicy {
  private tail: Promise<void> = Promise.resolve()
  private pending = 0

  constructor(
    private readonly inner: YachtBotPolicy,
    /** 양보 한 번. 테스트가 바꿔 끼운다. */
    private readonly yieldToEventLoop: () => Promise<void> = () =>
      new Promise((resolve) => setImmediate(resolve)),
    private readonly maxQueued: number = DEFAULT_MAX_QUEUED_SEARCHES,
    /** 위 {@link DEFAULT_SETTLE_TIMEOUT_MS} 참고. 테스트가 짧게 바꿔 끼운다. */
    private readonly settleTimeoutMs: number = DEFAULT_SETTLE_TIMEOUT_MS,
  ) {}

  /** 아직 끝나지 않은 탐색 수(대기 중 + 실행 중). 관측용. */
  get queued(): number {
    return this.pending
  }

  decide(board: ScoreBoard, dice: readonly number[], rollCount: number): Promise<BotDecision> {
    if (this.pending >= this.maxQueued) return Promise.reject(new BotQueueFullError(this.maxQueued))
    this.pending += 1
    const work = this.tail
      .then(this.yieldToEventLoop)
      .then(() => this.inner.decide(board, dice, rollCount))
    const run = this.withSettleTimeout(work)
    // 실패·시간 초과가 큐를 끊지 않게 꼬리에는 결과를 버린 약속을 둔다. 시간 초과면
    // settle되지 않은 탐색은 버리고 다음 탐색을 시작한다 — pending도 함께 회수된다.
    this.tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run.finally(() => {
      this.pending -= 1
    })
  }

  /** 내부 정책이 영영 settle되지 않아도 큐가 막히지 않게 상한을 둔다. */
  private withSettleTimeout(work: Promise<BotDecision>): Promise<BotDecision> {
    let timer!: NodeJS.Timeout
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new BotDecisionError(`bot search did not settle within ${this.settleTimeoutMs}ms`),
          ),
        this.settleTimeoutMs,
      )
      timer.unref()
    })
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
  }
}
