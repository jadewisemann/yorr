/**
 * 라운드 진행 서비스가 **자기 바깥**에 요구하는 것들 — 전부 이 파일의 좁은
 * 포트로만 표현한다.
 *
 * 왜 포트인가: 방·브로드캐스터·레지스트리·게임 종료·점수 제출을 구체 타입으로
 * 직접 잡으면 라운드 프레임워크가 ① 함께 고쳐지는 계층(점수·게임 종료)에 컴파일
 * 의존을 만들고 ② `docs/design/game-modules.md`의 "도메인 규칙은 전송 계층을
 * 모른다"를 깬다.
 * 여기 선언된 인터페이스는 실제 클래스(`RoomBroadcaster`·`RoomSessionRegistry`·
 * `RoomService`)가 **구조적으로 이미 만족**하므로 어댑터 코드가 필요 없다
 * (`__tests__/roundPorts.contract.test.ts`가 그 대입 가능성을 고정한다).
 */

/** `ws/envelope.ts`의 `OutboundEnvelope`와 같은 모양. 타입 하나 때문에 ws 모듈에 묶이지 않는다. */
export interface RoundOutboundEnvelope {
  readonly type: string
  readonly ts: number
  readonly payload: unknown
  readonly roomId?: string | undefined
  readonly msgId?: string | undefined
}

/** `RoomBroadcaster`가 그대로 만족한다(팬아웃 1회 직렬화는 그쪽 책임). */
export interface RoundBroadcaster {
  broadcast(roomId: string, message: RoundOutboundEnvelope): void
}

/**
 * 접속 상태 조회·좌석 제거 — `RoomSessionRegistry`가 그대로 만족한다.
 *
 * `status`를 `PlayerStatus` 유니온이 아니라 `string`으로 받는 이유: 라운드 쪽이
 * 실제로 묻는 것은 "offline인가" 하나뿐이라, 와이어 상태 목록이 늘어나도 여기가
 * 따라 바뀔 이유가 없다.
 */
export interface RoundPresence {
  find(roomId: string, playerId: string): { readonly status: string } | null
  /** @returns 실제로 빠진 좌석. 이미 없었으면 null(멱등 판정에 쓴다). */
  removePlayer(roomId: string, playerId: string): { readonly playerId: string } | null
}

/** 라운드가 방 스냅샷에서 실제로 읽는 것만. `RoomSnapshot`이 그대로 만족한다. */
export interface RoundRoomSnapshot {
  readonly gameId: string | null
  readonly players: readonly { readonly playerId: string; readonly kind: string }[]
}

/** `RoomService`의 부분집합 — 방 TTL 슬라이딩·이탈·스냅샷 조회. */
export interface RoundRoomService {
  /** 턴이 시작될 때마다 방 수명을 다시 센다(없으면 긴 판에서 방이 사라진다). */
  touch(roomId: string): Promise<unknown> | unknown
  leave(roomId: string, playerId: string): Promise<unknown> | unknown
  getSnapshot(roomId: string): Promise<RoundRoomSnapshot | null>
}

/**
 * 게임 종료 판정(2.7 `GameCompletionService.finishIfComplete`).
 *
 * @returns 종료 전이가 성사됐으면 true — 그때 타이머는 다음 턴을 걸지 않는다.
 */
export interface GameCompletionPort {
  finishIfComplete(roomId: string, force: boolean): Promise<boolean> | boolean
}

/** 점수 확정 결과 중 라운드가 방송에 쓰는 부분만(2.6 `ScoreConfirmationResult`). */
export interface ConfirmedScore {
  readonly playerId: string
  /** 12칸 + 집계가 든 점수판. 라운드는 내용을 해석하지 않고 그대로 싣는다. */
  readonly scoreboard: unknown
}

/** WS `round.submit` 페이로드(정본: `frontend/src/realtime/wsEvents.ts`). */
export interface RoundSubmitPayload {
  readonly roundNumber: number
  readonly dice: readonly number[]
  readonly category: string
}

/** WS `dice.roll` 페이로드. */
export interface DiceRollPayload {
  readonly roundNumber: number
  readonly rollCount: number
  readonly held: readonly boolean[]
}

/** WS `dice.hold` 페이로드 — KEEP은 델타가 아니라 전체 배열이다. */
export interface DiceHoldPayload {
  readonly roundNumber: number
  readonly held: readonly boolean[]
}

/**
 * 점수 확정 + 라운드 전이를 한 덩어리로 처리한 결과(2.6
 * `ScoreRoundSubmissionResult`). 타임아웃 경로로 들어오면 점수 방송을
 * `RoundTimeoutResolver`가 이미 했으므로 타이머에는 `score: null`로 전달된다.
 */
export interface ScoreRoundSubmissionOutcome<R> {
  readonly score: ConfirmedScore | null
  readonly round: R
}

/**
 * 2.6 `ScoreRoundSubmissionService`의 자리. 라운드 검증 후·커밋 전에 점수를
 * 확정하고(실패하면 라운드 상태 무변화) 결과를 함께 돌려준다.
 */
export interface ScoreRoundSubmissionPort<R> {
  submit(
    roomId: string,
    playerId: string,
    payload: RoundSubmitPayload,
  ): Promise<ScoreRoundSubmissionOutcome<R>>
}

/**
 * 2.6 `ScoreConfirmationService.openCategories`의 자리 — 아직 비어 있는 족보.
 *
 * `ScoreCategory` enum이 아니라 **api key 문자열**을 주고받는다: `RoundSubmission`이
 * 이미 카테고리를 문자열로 들고 있는 것과 같은 경계다(라운드 → 점수 도메인 의존 금지).
 */
export interface OpenCategoriesPort {
  openCategories(gameId: string, playerId: string): Promise<readonly string[]> | readonly string[]
}

/**
 * 점수판이 바뀌었다는 통지 한 통.
 *
 * 시간 초과로 서버가 자동 확정할 때(`roundTimeoutResolver`)와 사람이 보낸 확정
 * 요청에 답할 때(`roundTimerService`)가 **같은 모양**을 써야 한다. 클라이언트는
 * 두 경우를 가르지 않고 점수판을 갈아 끼우기 때문이다. 요청에 답하는 쪽만
 * `msgId`를 실어 어느 요청의 결과인지 알린다.
 */
export const scoreUpdateEnvelope = (params: {
  readonly type: string
  readonly ts: number
  readonly roomId: string
  readonly score: ConfirmedScore
  readonly msgId?: string | undefined
}): RoundOutboundEnvelope => ({
  type: params.type,
  ts: params.ts,
  payload: { playerId: params.score.playerId, scoreboard: params.score.scoreboard },
  roomId: params.roomId,
  msgId: params.msgId,
})
