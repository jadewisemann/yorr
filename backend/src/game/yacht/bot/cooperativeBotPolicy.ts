import type { ScoreBoard } from '../../score/index.js'
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
 */
export class CooperativeYachtBotPolicy implements YachtBotPolicy {
  private tail: Promise<void> = Promise.resolve()
  private pending = 0

  constructor(
    private readonly inner: YachtBotPolicy,
    /** 양보 한 번. 테스트가 바꿔 끼운다. */
    private readonly yieldToEventLoop: () => Promise<void> = () =>
      new Promise((resolve) => setImmediate(resolve)),
  ) {}

  /** 아직 끝나지 않은 탐색 수(대기 중 + 실행 중). 관측용. */
  get queued(): number {
    return this.pending
  }

  decide(board: ScoreBoard, dice: readonly number[], rollCount: number): Promise<BotDecision> {
    this.pending += 1
    const run = this.tail
      .then(this.yieldToEventLoop)
      .then(() => this.inner.decide(board, dice, rollCount))
      .finally(() => {
        this.pending -= 1
      })
    // 실패가 큐를 끊지 않게 꼬리에는 결과를 버린 약속을 둔다.
    this.tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}
