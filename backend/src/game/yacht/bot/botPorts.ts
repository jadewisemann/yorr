import type {
  DiceHoldPayload,
  DiceRollPayload,
  RoundRoomSnapshot,
  RoundState,
  RoundSubmitPayload,
} from '../../round/index.js'
import type { ScoreBoard, ScoreCategory } from '../../score/index.js'
import type { BotDecision } from './expectimaxYachtBotPolicy.js'

/**
 * 봇 스택(3.2)이 **자기 바깥**에 요구하는 것들. 3.1의 `yachtPorts.ts`와 같은 이유로
 * 좁은 포트만 둔다 — `RoundSynchronizationService`·`YachtTurnActionService`·
 * `RoomService`·`ScoreConfirmationService`가 전부 private 필드를 가진 클래스라
 * TS에서 **명목 타입**이고, 포트가 없으면 Java 테스트의 `mock(...)` 자리에 구조적
 * 스텁을 넣을 수 없다.
 *
 * 여기 선언된 것들은 실제 구현이 **구조적으로 이미 만족**하므로 어댑터가 없다 —
 * `__tests__/botPorts.contract.test.ts`가 대입 가능성을 고정한다.
 */

/**
 * 봇의 **유일한 행동 진입점** — 3.1 `YachtTurnActionService`가 그대로 만족한다.
 *
 * 세 번째 인자(`requestMsgId`)에 봇은 항상 `null`을 넘긴다. 그러면 응답 봉투에서
 * `msgId`가 사라져 프론트가 "내 굴림"으로 오인하지 않는다(Java의 봇 동작과 같다).
 * 이 서비스는 `dice.shaken`을 내지 않으므로 "봇은 shake를 안 낸다"가 자동 성립한다.
 */
export interface YachtBotActions {
  roll(
    roomId: string,
    actorId: string,
    payload: DiceRollPayload,
    requestMsgId: string | null,
  ): Promise<RoundState>
  hold(
    roomId: string,
    actorId: string,
    payload: DiceHoldPayload,
    requestMsgId: string | null,
  ): Promise<RoundState>
  submitScore(
    roomId: string,
    actorId: string,
    payload: RoundSubmitPayload,
    requestMsgId: string | null,
  ): Promise<unknown>
}

/** `RoundSynchronizationService`의 조회 하나. 봇은 상태를 **읽기만** 한다. */
export interface YachtBotRoundLookup {
  findByRoomId(roomId: string): Promise<RoundState | undefined>
}

/**
 * `RoomService.getSnapshot`. 봇 판정의 유일한 근거가 여기 있다 — `kind === 'BOT'`은
 * `room:{code}:bots` 해시(1.6)에서 온 값이다.
 */
export interface YachtBotRoomService {
  getSnapshot(roomId: string): Promise<RoundRoomSnapshot | null>
}

/** `ScoreConfirmationService`의 조회 둘. 확정(`confirm`)은 제출 경로가 알아서 한다. */
export interface YachtBotScoreLookup {
  scoreBoard(gameId: string, playerId: string): Promise<ScoreBoard>
  openCategories(gameId: string, playerId: string): Promise<readonly ScoreCategory[]>
}

/**
 * 주 정책의 자리 — `ExpectimaxYachtBotPolicy`가 만족한다.
 *
 * 반환을 `BotDecision | Promise<BotDecision>`으로 넓혀 뒀다: 지금 구현은 동기
 * 인라인이지만, CPU 예산 재검토에서 `worker_threads`로 옮기기로 하면 **코디네이터를
 * 고치지 않고** 구현만 바꿀 수 있어야 한다(docs/design/games/yacht.md 「CPU 예산」).
 */
export interface YachtBotPolicy {
  decide(
    board: ScoreBoard,
    dice: readonly number[],
    rollCount: number,
  ): BotDecision | Promise<BotDecision>
}

/** 폴백 정책의 자리 — `LocalYachtBotStrategy`가 만족한다. */
export interface YachtBotFallbackStrategy {
  chooseHeld(dice: readonly number[]): readonly boolean[]
  chooseCategory(dice: readonly number[], openCategories: readonly ScoreCategory[]): ScoreCategory
}
