import type {
  ScoreConfirmationResult,
  ScoreConfirmationService,
} from './scoreConfirmationService.js'
import { ScoreConfirmationError } from './scoreErrors.js'

/**
 * `round.submit`의 payload 모양(Java `RoundSubmitPayload`). WS 계층의 타입을
 * import하지 않으려고 **구조적으로만** 요구한다 — 도메인은 전송 계층을 모른다.
 */
export interface RoundSubmitPayloadLike {
  readonly roundNumber: number
  readonly dice: readonly number[]
  readonly category: string
}

/**
 * 라운드 제출 포트 — Java `RoundSynchronizationService.submit(roomId, playerId,
 * payload, beforeStateChange)` 자리다.
 *
 * **구체 타입을 import하지 않는다.** 2.5가 이 시그니처의 서비스를 들고 오고,
 * 그 안에서 `RoundStateStore.submitAtomically`가 호출되며 `beforeStateChange`가
 * 우리 점수 확정이 된다. 포트가 이 자리에 있는 이유는 그 콜백이 **라운드 검증
 * 후·상태 커밋 전**에 돌아야 하기 때문이다 — 점수 확정이 실패하면 라운드 상태는
 * 무변화로 남아 그 플레이어가 재시도할 수 있다
 * (docs/design/game-modules.md 「불변식」).
 *
 * `TRoundResult`는 라운드 쪽 결과 타입(`RoundSubmissionResult`)을 그대로 통과시키기
 * 위한 것이다. 점수 파이프라인은 그 내용을 들여다보지 않는다.
 */
export interface RoundSubmitPort<TRoundResult> {
  submit(
    roomId: string,
    playerId: string,
    payload: RoundSubmitPayloadLike,
    beforeStateChange: () => Promise<void>,
  ): Promise<TRoundResult>
}

/** 방의 현재 gameId를 아는 최소 포트 — `RoomService.getSnapshot`이 구조적으로 들어맞는다. */
export interface CurrentGameLookup {
  getSnapshot(roomId: string): Promise<{ readonly gameId: string | null }>
}

/** Java `ScoreRoundSubmissionResult` record 자리. */
export interface ScoreRoundSubmissionResult<TRoundResult> {
  /** 확정된 점수. 콜백이 돌지 않는 경로는 없으므로 성공 시 항상 채워진다. */
  readonly score: ScoreConfirmationResult | null
  readonly round: TRoundResult
}

/**
 * 라운드 제출과 점수 확정의 **원자 결합**(backend-java `ScoreRoundSubmissionService`).
 *
 * 순서가 계약이다: 라운드 검증 → **점수 확정(Redis Lua)** → 라운드 상태 커밋.
 * 점수 확정이 던지면 커밋은 일어나지 않는다. 반대 순서였다면 "제출은 됐는데
 * 점수는 없는" 플레이어가 생기고, 그 칸은 영원히 비어 게임이 끝나지 않는다.
 */
export class ScoreRoundSubmissionService<TRoundResult> {
  private readonly rounds: RoundSubmitPort<TRoundResult>
  private readonly scores: ScoreConfirmationService
  private readonly rooms: CurrentGameLookup

  constructor(
    rounds: RoundSubmitPort<TRoundResult>,
    scores: ScoreConfirmationService,
    rooms: CurrentGameLookup,
  ) {
    this.rounds = rounds
    this.scores = scores
    this.rooms = rooms
  }

  async submit(
    roomId: string,
    playerId: string,
    payload: RoundSubmitPayloadLike,
  ): Promise<ScoreRoundSubmissionResult<TRoundResult>> {
    // Java의 AtomicReference 자리 — 콜백 안에서 채운 값을 밖으로 들고 나온다.
    const holder: { value: ScoreConfirmationResult | null } = { value: null }
    const round = await this.rounds.submit(roomId, playerId, payload, async () => {
      holder.value = await this.confirmScore(roomId, playerId, payload)
    })
    return { score: holder.value, round }
  }

  /**
   * 현재 게임을 방 스냅샷에서 읽는다. 게임이 없으면 **점수 확정 자체를 시도하지
   * 않고** `GAME_NOT_FOUND`로 던져 라운드 상태를 그대로 둔다.
   */
  private async confirmScore(
    roomId: string,
    playerId: string,
    payload: RoundSubmitPayloadLike,
  ): Promise<ScoreConfirmationResult> {
    const room = await this.rooms.getSnapshot(roomId)
    const gameId = room?.gameId
    if (gameId === null || gameId === undefined || gameId.trim().length === 0) {
      throw new ScoreConfirmationError(
        'GAME_NOT_FOUND',
        `진행 중인 게임을 찾을 수 없습니다: ${roomId}`,
      )
    }
    return this.scores.confirm({
      gameId,
      playerId,
      roundNumber: payload.roundNumber,
      category: payload.category,
      dice: payload.dice,
    })
  }
}
