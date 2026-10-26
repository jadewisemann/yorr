import type { RoundRoll, RoundState, RoundSubmissionResult } from './roundState.js'
import type { RoundSubmission } from './roundSubmission.js'

/**
 * 라운드 상태 저장소 포트.
 *
 * **모든 메서드가 async다** — 운영 어댑터는 Redis(방 락 + JSON 스냅샷)이고
 * `beforeStateChange`(점수 확정)도 Redis Lua라 동기일 수 없다. 인메모리 구현은
 * 방 단위 프라미스 락으로 "검증 → 콜백 → 커밋" 구간의 끼어들기를 막아 같은
 * 계약을 지킨다.
 *
 * 구현은 `roundStateStoreInMemory.ts`(테스트 시드)와
 * `yacht/redisYachtDiceStateStore.ts`(운영)에 있다.
 */
export interface RoundStateStore {
  /** SETNX 시맨틱 — 이중 초기화는 `ROUND_ALREADY_INITIALIZED`. */
  initialize(roomId: string, initialState: RoundState): Promise<void>

  /**
   * 제출 하나를 적용하고 결과 상태를 저장하는 것을 **한 덩어리로** 처리한다.
   * 두 개의 마지막 제출이 같은 라운드를 두 번 완료시키지 못해야 한다.
   *
   * `beforeStateChange`는 **라운드 검증 후·상태 커밋 전**에 실행된다. 던지면
   * 라운드 상태는 무변화 — 점수 저장이 실패한 플레이어가 미제출로 남아 재시도할
   * 수 있는 근간이다(docs/design/game-modules.md 「불변식」).
   */
  submitAtomically(
    roomId: string,
    submission: RoundSubmission,
    beforeStateChange: () => void | Promise<void>,
  ): Promise<RoundSubmissionResult>

  recordRollAtomically(roomId: string, roll: RoundRoll): Promise<RoundState>

  /** 굴림 사이에 활성 플레이어가 바꾼 KEEP을 저장한다. */
  recordHoldAtomically(
    roomId: string,
    playerId: string,
    roundNumber: number,
    held: readonly boolean[],
  ): Promise<RoundState>

  /**
   * 활성 플레이어를 대신해 한 번 굴린다. 단 **기대한 턴이 아직 현재일 때만**,
   * 그리고 굴림이 남아 있을 때만. 턴이 이미 지났거나 굴림을 다 썼으면 undefined —
   * 호출자는 그때 점수 기록으로 넘어간다.
   */
  autoRollAtomically(
    roomId: string,
    expectedRoundNumber: number,
    expectedActivePlayerId: string,
    rolledDice: readonly number[],
  ): Promise<RoundState | undefined>

  /**
   * 기대한 턴이 아직 현재일 때만 무득점으로 턴을 넘긴다. 방이 사라졌거나 다른
   * 경로가 이미 진행시켰으면 undefined.
   */
  expireAtomically(
    roomId: string,
    expectedRoundNumber: number,
    expectedActivePlayerId: string,
  ): Promise<RoundSubmissionResult | undefined>

  /**
   * 이탈한 참가자를 턴 순서에서 뺀다(턴은 넘기지 않는다). 활성 플레이어라면
   * 먼저 `expireAtomically`로 넘겨야 한다. 라운드 상태가 없으면 undefined.
   */
  removeParticipantAtomically(roomId: string, playerId: string): Promise<RoundState | undefined>

  findByRoomId(roomId: string): Promise<RoundState | undefined>

  /**
   * 라운드 상태를 들고 있는 모든 방. 방이 사라졌는데도 남은 항목을 주기적으로
   * 걷어내는 스윕이 이 목록을 쓴다 — 이게 없으면 회수 경로가 유예 타이머
   * 하나뿐이고, 그 타이머는 프로세스 재시작에 사라져 아무도 치우지 않는 상태가 된다.
   */
  roomIds(): Promise<string[]>

  remove(roomId: string): Promise<boolean>
}

/** 인메모리 어댑터는 포트와 같은 파일에 두면 계약이 구현에 묻힌다 — 따로 둔다. */
export { InMemoryRoundStateStore } from './roundStateStoreInMemory.js'
