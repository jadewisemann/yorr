import type { DiceHoldPayload, DiceRollPayload, RoundSubmitPayload } from './roundPorts.js'
import { DEFAULT_TOTAL_ROUNDS, RoundState, type RoundSubmissionResult } from './roundState.js'
import type { RoundStateStore } from './roundStateStore.js'
import { DICE_COUNT, RoundSubmission } from './roundSubmission.js'

/**
 * 주사위 하나의 값(1~6)을 만드는 시임 — Java `IntSupplier dieRoller`.
 *
 * **서버 권위 RNG의 유일한 출처다**(DESIGN.md 원칙 1: 주사위는 서버가 만든다).
 * 클라이언트가 보낸 물리 결과는 이 자리에 들어올 수 없다.
 */
export type DieRoller = () => number

/** 운영 기본값. Java `ThreadLocalRandom.current().nextInt(1, 7)` 자리. */
export const randomDieRoller = (): DieRoller => () => 1 + Math.floor(Math.random() * 6)

/**
 * 시드 고정 RNG(mulberry32). 테스트·재현용이다 — 같은 시드는 항상 같은 판을 만든다.
 *
 * Java에는 대응물이 없다(테스트가 `() -> 1` 같은 상수 공급자를 썼다). 상수 공급자는
 * "다섯 개가 전부 같은 값"이라 주사위 분포에 기대는 회귀(킵 유지 등)를 못 잡는다.
 */
export const seededDieRoller = (seed: number): DieRoller => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return 1 + (((value ^ (value >>> 14)) >>> 0) % 6)
  }
}

export interface RoundSynchronizationServiceOptions {
  /** 주입하지 않으면 `randomDieRoller()`. 테스트는 여기로 주사위를 고정한다. */
  readonly dieRoller?: DieRoller
}

/**
 * 라운드 상태 저장소 위에 얹힌 얇은 응용 서비스 — 이다.
 *
 * 두 가지만 한다: ① WS 페이로드를 도메인 인자로 옮기고 ② **서버 주사위를 굴린다**.
 * 원자성·검증은 전부 `RoundStateStore`와 `RoundState`가 갖고 있다.
 */
export class RoundSynchronizationService {
  private readonly store: RoundStateStore
  private readonly dieRoller: DieRoller

  constructor(store: RoundStateStore, options: RoundSynchronizationServiceOptions = {}) {
    this.store = store
    this.dieRoller = options.dieRoller ?? randomDieRoller()
  }

  async initialize(
    roomId: string,
    roundNumber: number,
    participantIds: Iterable<string>,
    totalRounds: number = DEFAULT_TOTAL_ROUNDS,
  ): Promise<RoundState> {
    const initialState = RoundState.start(roundNumber, participantIds, totalRounds)
    await this.store.initialize(roomId, initialState)
    return initialState
  }

  /**
   * @param beforeStateChange 라운드 검증 후·상태 커밋 전에 실행된다. 던지면 라운드
   * 상태는 무변화 — 점수 저장이 실패한 플레이어는 미제출로 남아 재시도할 수 있다.
   */
  async submit(
    roomId: string,
    playerId: string,
    payload: RoundSubmitPayload,
    beforeStateChange: () => void | Promise<void> = () => {},
  ): Promise<RoundSubmissionResult> {
    const submission = new RoundSubmission(
      playerId,
      payload.roundNumber,
      payload.dice,
      payload.category,
    )
    return this.store.submitAtomically(roomId, submission, beforeStateChange)
  }

  /** 기대한 턴이 아직 현재일 때만 무득점으로 넘긴다. 스테일이면 undefined. */
  async expire(
    roomId: string,
    expectedRoundNumber: number,
    expectedActivePlayerId: string,
  ): Promise<RoundSubmissionResult | undefined> {
    return this.store.expireAtomically(roomId, expectedRoundNumber, expectedActivePlayerId)
  }

  /**
   * 마감 시각이 지난 턴을 대신해 한 번 굴린다. 굴림이 남지 않았거나 그 사이 턴이
   * 넘어갔으면 undefined — 호출자는 그때 점수 기록으로 넘어간다.
   */
  async autoRoll(
    roomId: string,
    roundNumber: number,
    activePlayerId: string,
  ): Promise<RoundState | undefined> {
    return this.store.autoRollAtomically(roomId, roundNumber, activePlayerId, this.rollDice())
  }

  async recordRoll(
    roomId: string,
    playerId: string,
    payload: DiceRollPayload,
  ): Promise<RoundState> {
    return this.store.recordRollAtomically(
      roomId,
      playerId,
      payload.roundNumber,
      payload.rollCount,
      payload.held,
      this.rollDice(),
    )
  }

  /** 굴림 사이에 바꾼 KEEP을 서버 상태에 반영한다. 관전자 방송·자동 굴림이 이 값을 쓴다. */
  async recordHold(
    roomId: string,
    playerId: string,
    payload: DiceHoldPayload,
  ): Promise<RoundState> {
    return this.store.recordHoldAtomically(roomId, playerId, payload.roundNumber, payload.held)
  }

  /**
   * 게임 중 이탈한 참가자를 턴 순서에서 뺀다. 활성 플레이어는 먼저 `expire`로
   * 턴을 넘긴 뒤에만 뺄 수 있다(`RoundState.withoutParticipant`).
   */
  async removeParticipant(roomId: string, playerId: string): Promise<RoundState | undefined> {
    return this.store.removeParticipantAtomically(roomId, playerId)
  }

  async findByRoomId(roomId: string): Promise<RoundState | undefined> {
    return this.store.findByRoomId(roomId)
  }

  /** 라운드 상태를 들고 있는 모든 방. 고아 상태를 걷어내는 스윕(2.8)이 쓴다. */
  async roomIds(): Promise<string[]> {
    return this.store.roomIds()
  }

  async remove(roomId: string): Promise<boolean> {
    return this.store.remove(roomId)
  }

  private rollDice(): number[] {
    return Array.from({ length: DICE_COUNT }, () => this.dieRoller())
  }
}
