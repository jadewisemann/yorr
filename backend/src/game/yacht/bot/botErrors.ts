/**
 * 봇 스택 내부 오류. **와이어로 나가지 않는다** — 코디네이터가 정책 실패를 잡아
 * 폴백 전략으로 내려가고, 오케스트레이터가
 * 나머지를 삼킨다(라운드 타이머가 최종 폴백이다).
 *
 * 그래서 `CodedError` 계열이 아니다: `errors.ts`의 코드 문자열은 REST·WS 응답 본문에
 * 그대로 실리는 계약인데, 이 오류들은 응답이 되는 경로가 없다. 계약을 넓히지 않으려면
 * 그 계열에 끼지 않는 쪽이 맞다.
 */

/** 봇 결정이 만들 수 없는 상태 — 정책·코디네이터의 인자·상태 검증 실패. */
export class BotDecisionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = new.target.name
  }
}

/**
 * Expectimax 탐색이 CPU 예산을 넘겨 **스스로 중단**했다.
 *
 * Node는 단일 스레드라 탐색이 이벤트 루프를 물고 있는 동안 **다른 방의 WS·하트비트·
 * 라운드 마감이 전부 줄을 선다** — 그래서 예산을 테스트 단정이 아니라 런타임
 * 불변식으로 승격시켰다(docs/design/games/yacht.md 「CPU 예산」).
 */
export class BotSearchBudgetError extends BotDecisionError {
  readonly budgetMs: number
  readonly elapsedMs: number

  constructor(budgetMs: number, elapsedMs: number) {
    super(`expectimax search exceeded its ${budgetMs}ms budget after ${elapsedMs}ms`)
    this.budgetMs = budgetMs
    this.elapsedMs = elapsedMs
  }
}
