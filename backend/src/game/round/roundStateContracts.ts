/**
 * 라운드 상태의 값 계약과 입력 검증. `RoundState`(전이)와 달리 여기에는 **상태가 없다** —
 * 스냅샷 복원·포트·호출부가 함께 쓰는 모양과, 잘못된 입력을 거절하는 규칙만 있다.
 */
import { RoundSynchronizationError } from './roundErrors.js'
import type { RoundState } from './roundState.js'
import { DICE_COUNT, type RoundSubmission } from './roundSubmission.js'

/** 한 턴에 허용되는 굴림 횟수. 이 수에 도달하면 남은 굴림이 없다. */
export const MAX_ROLL_COUNT = 3
/** 요트 정규룰 족보 수 = 한 게임의 라운드 수. 참가자가 이만큼 기록하면 점수판이 꽉 찬다. */
export const DEFAULT_TOTAL_ROUNDS = 12

export const NO_HELD: readonly boolean[] = Object.freeze([false, false, false, false, false])

/**
 * 굴림 한 번의 입력 묶음 — 어느 플레이어가 몇 번째 굴림에서 무엇을 굴렸는가.
 *
 * 값 네 개(`roundNumber`·`rollCount`·`held`·`rolledDice`)는 항상 함께 다니므로
 * 따로 넘기면 순서를 틀릴 수 있다. 포트·구현·호출부가 이 한 타입을 공유한다.
 */
export interface RoundRoll {
  readonly playerId: string
  readonly roundNumber: number
  readonly rollCount: number
  readonly held: readonly boolean[]
  readonly rolledDice: readonly number[]
}

/** 라운드 하나가 끝났을 때의 결과 요약. */
export interface RoundCompletion {
  readonly roundNumber: number
  readonly submittedPlayerIds: readonly string[]
  /** 게임이 끝났다면 다음 라운드가 없으므로 `roundNumber`와 같다. */
  readonly nextRoundNumber: number
  /**
   * 마지막 라운드가 끝났는지. true면 다음 턴 타이머를 걸어선 안 된다.
   *
   * 게임 종료의 **주 판정은 Redis**(전원 점수판 12칸 + phase CAS)이고 이 플래그는
   * 안전망이다. 타임아웃으로 빈 칸이 남아 Redis 판정이 성립하지 않아도 라운드
   * 상한에서 반드시 멈추게 해 라운드가 무한히 증가하는 것을 막는다.
   */
  readonly gameCompleted: boolean
}

/**
 * 전이 결과. `completedRound`가 null이 아니면 그 전이로 라운드가 끝났다
 * (Optional 대신 null).
 */
export interface RoundSubmissionResult {
  readonly state: RoundState
  readonly completedRound: RoundCompletion | null
}

/** `RoundState.restore`의 입력 = 저장소 스냅샷의 모양. */
export interface RoundStateProps {
  readonly roundNumber: number
  readonly totalRounds: number
  readonly participantOrder: readonly string[]
  readonly submissions: ReadonlyMap<string, RoundSubmission>
  readonly activePlayerIndex: number
  readonly activeRollCount: number
  readonly activeDice: readonly number[] | null
  readonly activeHeld: readonly boolean[] | null
  readonly finished: boolean
}

export const validateRoundNumber = (roundNumber: number): number => {
  if (roundNumber < 1) {
    throw new RoundSynchronizationError('INVALID_ROUND', 'roundNumber must be at least 1')
  }
  return roundNumber
}

export const validateTotalRounds = (totalRounds: number, roundNumber: number): number => {
  if (totalRounds < 1) {
    throw new RoundSynchronizationError('INVALID_ROUND', 'totalRounds must be at least 1')
  }
  if (roundNumber > totalRounds) {
    throw new RoundSynchronizationError(
      'INVALID_ROUND',
      `roundNumber must not exceed totalRounds: ${roundNumber} > ${totalRounds}`,
    )
  }
  return totalRounds
}

export const validateHeld = (held: readonly boolean[]): void => {
  if (held.length !== DICE_COUNT || held.some((value) => typeof value !== 'boolean')) {
    throw new RoundSynchronizationError(
      'INVALID_ROLL',
      'held must contain exactly five boolean values',
    )
  }
}

export const validateDice = (dice: readonly number[]): void => {
  if (
    dice.length !== DICE_COUNT ||
    dice.some((value) => !Number.isInteger(value) || value < 1 || value > 6)
  ) {
    throw new RoundSynchronizationError(
      'INVALID_DICE',
      'exactly five dice values between 1 and 6 are required',
    )
  }
}

export const immutableParticipants = (participantIds: Iterable<string>): readonly string[] => {
  const copy = new Set<string>()
  for (const playerId of participantIds) {
    if (playerId === null || playerId === undefined || playerId.trim().length === 0) {
      throw new RoundSynchronizationError(
        'INVALID_PLAYER',
        'participant playerId must not be blank',
      )
    }
    if (copy.has(playerId)) {
      throw new RoundSynchronizationError(
        'INVALID_PLAYER',
        `duplicate participant playerId: ${playerId}`,
      )
    }
    copy.add(playerId)
  }
  if (copy.size === 0) {
    throw new RoundSynchronizationError('INVALID_PLAYER', 'at least one participant is required')
  }
  return Object.freeze([...copy])
}

/** 제출 dice는 서버가 굴린 dice와 **완전히 일치**해야 한다. */
export const sameDice = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])
