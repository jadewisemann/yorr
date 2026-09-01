import type {
  DiceHoldPayload,
  DiceRollPayload,
  RoundState,
  RoundSubmitPayload,
  TurnAdvanceInput,
} from '../round/index.js'

/**
 * 야추 모듈(3.1)이 **자기 바깥**에 요구하는 것들 — 전부 이 파일의 좁은 포트로만
 * 표현한다.
 *
 * 왜 포트인가: 모듈과 턴 서비스가
 * `RoundSynchronizationService`·`RoundTimerService`·`RoomSessionRegistry`·
 * `RealtimeRoomSnapshotService`·`RoomBroadcaster`·`GameReconnectSnapshotService`·
 * `ScoreRoundSubmissionService`를 구체 타입으로 직접 잡는다. 2.5(`round/roundPorts.ts`)·
 * 2.8(`reconnect/reconnectPorts.ts`)이 같은 이유로 뒤집었고 여기서도 뒤집는다:
 * ① 전송 계층(ws)·방 도메인(room)에 대한 컴파일 의존을 만들지 않고
 * ② **`RoundTimerService`·`RoundSynchronizationService`가 private 필드를 가진 클래스라
 * TS에서 명목 타입**이어서, 포트가 없으면 테스트가 구조적 스텁을 넣을 수 없다
 * (2.5가 `RoundTimeoutResolverPort`를 둔 것과 같은 이유).
 *
 * **라운드 도메인 타입(`RoundState`·`RoundSubmitPayload` …)은 그대로 import한다.**
 * 그쪽은 "바깥 계층"이 아니라 이 모듈이 올라선 프레임워크이고, 모양을 다시
 * 선언하면 와이어·상태 계약이 두 곳으로 갈라진다(2.5가 `gameWsType` 사본을 지운
 * 것과 같은 판단).
 *
 * 여기 선언된 인터페이스는 실제 구현이 **구조적으로 이미 만족**하므로 어댑터
 * 코드가 없다 — `__tests__/yachtPorts.contract.test.ts`가 그 대입 가능성을 고정한다.
 */

/** `ws/envelope.ts`의 `OutboundEnvelope`와 같은 모양(2.5 `RoundOutboundEnvelope`와 동일 근거). */
export interface YachtOutboundEnvelope {
  readonly type: string
  readonly ts: number
  readonly payload: unknown
  readonly roomId?: string | undefined
  readonly msgId?: string | undefined
}

/** `RoomBroadcaster`가 그대로 만족한다(팬아웃 1회 직렬화는 그쪽 책임). */
export interface YachtBroadcaster {
  broadcast(roomId: string, message: YachtOutboundEnvelope): void
}

/**
 * WS 스냅샷의 phase 문자열. **소문자가 계약이다**(`ws/protocol.ts`의 `WsRoomPhase` —
 * Redis의 대문자 `PLAYING`과 다르다). 2.8이 `PLAYING_PHASE`를 같은 이유로 소문자로 뒀다.
 */
type YachtRoomPhase = 'waiting' | 'playing' | 'finished'

/**
 * 소켓 → 좌석 조회 + phase 마킹 — `RoomSessionRegistry`가 그대로 만족한다.
 *
 * `markPhase`가 여기 있는 것이 이 티켓의 숨은 핵심이다: **레지스트리 phase를 옮기는
 * 것은 게임 모듈의 일**이다. 이게 빠지면 REST로
 * 시작한 게임의 소켓 phase가 `waiting`에 머물러 끊긴 플레이어가 offline이 아니라
 * `room.player_left`가 되고, 재접속의 PLAYING 분기가 실전에서 도달하지 않는다.
 */
export interface YachtSeatRegistry {
  of(socket: YachtClientSocket): { readonly playerId: string; readonly roomId: string } | null
  markPhase(roomId: string, phase: YachtRoomPhase): void
}

/**
 * 모듈이 오류 응답을 직접 보내는 대상 — `ws/socket.ts`의 `ClientSocket`이 그대로
 * 만족한다(그쪽이 이미 "`ws`의 WebSocket과 가짜 소켓이 함께 만족하는 최소 표면"이다).
 */
export interface YachtClientSocket {
  readonly readyState: number
  send(data: string): void
}

/** `RealtimeRoomSnapshotService`의 자리 — `state.sync`에 실을 실시간 병합 스냅샷. */
export interface YachtRealtimeSnapshots<S> {
  snapshot(roomId: string): Promise<S>
}

/**
 * `GameReconnectSnapshotService.snapshot`의 자리(2.8).
 *
 * 반환 타입이 `S`보다 넓어도 된다(`ReconnectSnapshot<S> = S | (S & {game})`) —
 * 둘 다 `S`에 대입 가능하므로 이 포트를 그대로 만족한다.
 */
export interface YachtReconnectSnapshots<S> {
  snapshot(roomId: string, playerId: string): Promise<S>
}

/**
 * `RoundSynchronizationService`의 부분집합. 야추 모듈이 실제로 부르는 6개뿐이다 —
 * 마감 자동 굴림(`autoRoll`)·만료(`expire`)·참가자 제거는 타이머·해소기의 몫이라
 * 여기 없다.
 */
export interface YachtRoundService {
  initialize(
    roomId: string,
    roundNumber: number,
    participantIds: Iterable<string>,
    totalRounds?: number,
  ): Promise<RoundState>
  findByRoomId(roomId: string): Promise<RoundState | undefined>
  remove(roomId: string): Promise<boolean>
  recordRoll(roomId: string, playerId: string, payload: DiceRollPayload): Promise<RoundState>
  recordHold(roomId: string, playerId: string, payload: DiceHoldPayload): Promise<RoundState>
}

/**
 * `RoundTimerService`의 부분집합 — 턴 시계 조작 5개.
 *
 * `advanceTurn`의 세 번째 인자는 nullable한 `requestMsgId`다. 타이머
 * 구현이 기본값(`null`)을 갖고 있어도 이 시그니처를 만족한다.
 */
export interface YachtRoundTimer {
  start(roomId: string, state: RoundState): Promise<number | null>
  /**
   * 저장된 마감으로 이 턴을 이어간다 — **부팅 재무장 전용**이다(PR 6).
   *
   * `start`와 갈라져 있는 것이 요점이다: 새 턴에는 새 시간을 주는 것이 맞고, 재시작
   * 복구에는 원래 마감을 되살리는 것이 맞다. `false`면 되살릴 근거가 없다는 뜻이며
   * 호출자가 그 방을 fail-closed로 닫는다.
   */
  resumeFromStored(roomId: string, state: RoundState): Promise<boolean>
  advanceTurn(roomId: string, result: TurnAdvanceInput, requestMsgId: string | null): Promise<void>
  cancelRoom(roomId: string): Promise<void>
  removePlayer(roomId: string, playerId: string): Promise<void>
  /** 재접속 복귀 시 오프라인 결석 횟수 리셋. **스냅샷 조립 뒤에** 부른다(2.8의 순서 계약). */
  clearOfflineMisses(roomId: string, playerId: string): void
}

/**
 * `ScoreRoundSubmissionService<RoundSubmissionResult>`의 자리(2.6).
 *
 * 반환값이 곧 타이머의 `advanceTurn` 입력이라 `TurnAdvanceInput`을 그대로 쓴다 —
 * 2.6의 `ScoreRoundSubmissionResult<RoundSubmissionResult>`가 이 모양을 구조적으로
 * 만족한다(`ScoreConfirmationResult`가 `ConfirmedScore`의 `playerId`·`scoreboard`를
 * 갖는다).
 */
export interface YachtScoreSubmission {
  submit(roomId: string, playerId: string, payload: RoundSubmitPayload): Promise<TurnAdvanceInput>
}
