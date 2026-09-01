import { RoundSynchronizationError } from './roundErrors.js'
import { DICE_COUNT, type RoundSubmission } from './roundSubmission.js'

/** 한 턴에 허용되는 굴림 횟수. 이 수에 도달하면 남은 굴림이 없다. */
export const MAX_ROLL_COUNT = 3
/** 요트 정규룰 족보 수 = 한 게임의 라운드 수. 참가자가 이만큼 기록하면 점수판이 꽉 찬다. */
export const DEFAULT_TOTAL_ROUNDS = 12

const NO_HELD: readonly boolean[] = Object.freeze([false, false, false, false, false])

/** 라운드 하나가 끝났을 때의 결과 요약. */
interface RoundCompletion {
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

const validateRoundNumber = (roundNumber: number): number => {
  if (roundNumber < 1) {
    throw new RoundSynchronizationError('INVALID_ROUND', 'roundNumber must be at least 1')
  }
  return roundNumber
}

const validateTotalRounds = (totalRounds: number, roundNumber: number): number => {
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

const validateHeld = (held: readonly boolean[]): void => {
  if (held.length !== DICE_COUNT || held.some((value) => typeof value !== 'boolean')) {
    throw new RoundSynchronizationError(
      'INVALID_ROLL',
      'held must contain exactly five boolean values',
    )
  }
}

const validateDice = (dice: readonly number[]): void => {
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

const immutableParticipants = (participantIds: Iterable<string>): readonly string[] => {
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

/**
 * 한 방의 라운드 진행 상태 — **불변 객체**다. 모든 전이는 새 인스턴스를 돌려주고
 * 실패는 `RoundSynchronizationError`로 던진다.
 *
 * 조회는 메서드가 아니라 readonly 필드로 노출하고,
 * 파생값(`activePlayerId()`·`hasRollsLeft()`)은 getter로 옮겼다.
 *
 * 검증 순서가 계약이다: GAME_ALREADY_FINISHED → ROUND_MISMATCH →
 * PLAYER_NOT_IN_ROUND → NOT_ACTIVE_PLAYER.
 */
export class RoundState {
  readonly roundNumber: number
  readonly totalRounds: number
  readonly participantOrder: readonly string[]
  readonly participantIds: ReadonlySet<string>
  readonly submissions: ReadonlyMap<string, RoundSubmission>
  readonly activePlayerIndex: number
  readonly activeRollCount: number
  /** 첫 굴림 전에는 null. */
  readonly activeDice: readonly number[] | null
  /** 마지막 굴림에 쓰인 KEEP. 첫 굴림 전에는 null. */
  readonly activeHeld: readonly boolean[] | null
  /** 마지막 라운드까지 끝난 터미널 상태. 굴림·제출을 모두 거부한다. */
  readonly finished: boolean

  private constructor(props: RoundStateProps) {
    this.roundNumber = validateRoundNumber(props.roundNumber)
    this.totalRounds = validateTotalRounds(props.totalRounds, props.roundNumber)
    this.participantOrder = Object.freeze([...props.participantOrder])
    this.participantIds = new Set(this.participantOrder)
    this.submissions = new Map(props.submissions)
    this.activePlayerIndex = props.activePlayerIndex
    this.activeRollCount = props.activeRollCount
    this.activeDice = props.activeDice === null ? null : Object.freeze([...props.activeDice])
    this.activeHeld = props.activeHeld === null ? null : Object.freeze([...props.activeHeld])
    this.finished = props.finished
  }

  static start(
    roundNumber: number,
    participantIds: Iterable<string>,
    totalRounds: number = DEFAULT_TOTAL_ROUNDS,
  ): RoundState {
    return new RoundState({
      roundNumber,
      totalRounds,
      participantOrder: immutableParticipants(participantIds),
      submissions: new Map(),
      activePlayerIndex: 0,
      activeRollCount: 0,
      activeDice: null,
      activeHeld: null,
      finished: false,
    })
  }

  /** 저장소에서 읽은 스냅샷을 그대로 되살린다 — 여기서는 참가자 중복 검사를 하지 않는다. */
  static restore(props: RoundStateProps): RoundState {
    return new RoundState(props)
  }

  get activePlayerId(): string {
    const playerId = this.participantOrder[this.activePlayerIndex]
    if (playerId === undefined) {
      // 공개 전이로는 도달할 수 없고
      // 손상된 스냅샷을 restore했을 때만 나온다.
      throw new RoundSynchronizationError(
        'INVALID_PLAYER',
        `no participant at turn index ${this.activePlayerIndex}`,
      )
    }
    return playerId
  }

  get hasRollsLeft(): boolean {
    return this.activeRollCount < MAX_ROLL_COUNT
  }

  /** 이번 라운드에 이미 제출한 플레이어 — 제출 순서를 유지한다. */
  get submittedPlayerIds(): readonly string[] {
    return [...this.submissions.keys()]
  }

  /**
   * 굴림 하나를 기록한다. rollCount는 정확히 1씩만 올라가고(중복·건너뛰기 거부),
   * held로 표시된 자리는 **이전 주사위 값을 유지**한다.
   */
  recordRoll(
    playerId: string,
    submittedRoundNumber: number,
    rollCount: number,
    held: readonly boolean[],
    rolledDice: readonly number[],
  ): RoundState {
    this.validateCurrentPlayer(playerId, submittedRoundNumber)
    if (rollCount < 1 || rollCount > MAX_ROLL_COUNT || rollCount !== this.activeRollCount + 1) {
      throw new RoundSynchronizationError(
        'INVALID_ROLL',
        `rollCount must advance exactly once and stay between 1 and ${MAX_ROLL_COUNT}`,
      )
    }
    validateHeld(held)
    validateDice(rolledDice)
    const previousDice = this.activeDice
    if (previousDice === null && held.includes(true)) {
      throw new RoundSynchronizationError(
        'INVALID_ROLL',
        'dice cannot be held before the first roll',
      )
    }

    const nextDice = [...rolledDice]
    if (previousDice !== null) {
      for (let index = 0; index < held.length; index += 1) {
        const kept = previousDice[index]
        if (held[index] === true && kept !== undefined) nextDice[index] = kept
      }
    }
    return new RoundState({
      ...this.props(),
      activeRollCount: rollCount,
      activeDice: nextDice,
      activeHeld: held,
      finished: false,
    })
  }

  /**
   * 굴림 사이에 바꾼 KEEP을 기록한다(델타가 아니라 **전체 배열 교체**).
   *
   * 이게 없으면 서버가 아는 KEEP은 "마지막 굴림에 쓴 값"에 머문다. 그러면
   * 관전자에게 뿌릴 KEEP도, 마감 자동 굴림이 유지할 KEEP도 실제와 어긋난다.
   * 주사위가 깔리기 전에는 KEEP이 성립하지 않으므로 첫 굴림 전 호출은 거부한다.
   */
  recordHold(playerId: string, submittedRoundNumber: number, held: readonly boolean[]): RoundState {
    this.validateCurrentPlayer(playerId, submittedRoundNumber)
    if (this.activeDice === null) {
      throw new RoundSynchronizationError(
        'INVALID_ROLL',
        'dice cannot be held before the first roll',
      )
    }
    validateHeld(held)
    return new RoundState({ ...this.props(), activeHeld: held, finished: false })
  }

  /**
   * 마감 시각이 지났을 때 서버가 현재 턴 소유자를 대신해 한 번 굴린다.
   *
   * 마지막으로 알린 KEEP(`activeHeld`)을 그대로 유지해 플레이어가 모아둔 족보를
   * 날리지 않는다. 굴림이 남지 않은 턴은 이 메서드로 진행할 수 없다 — 호출자가
   * 먼저 `hasRollsLeft`를 보고 없으면 점수 기록으로 넘어가야 한다.
   */
  autoRoll(rolledDice: readonly number[]): RoundState {
    if (!this.hasRollsLeft) {
      throw new RoundSynchronizationError(
        'INVALID_ROLL',
        `no rolls left to auto roll for round ${this.roundNumber}`,
      )
    }
    return this.recordRoll(
      this.activePlayerId,
      this.roundNumber,
      this.activeRollCount + 1,
      this.activeHeld ?? NO_HELD,
      rolledDice,
    )
  }

  /** 제출 dice는 서버가 굴린 `activeDice`와 **완전히 일치**해야 한다. */
  submit(submission: RoundSubmission): RoundSubmissionResult {
    this.validateCurrentPlayer(submission.playerId, submission.roundNumber)
    if (this.activeDice === null) {
      throw new RoundSynchronizationError('INVALID_DICE', 'dice must be rolled before submission')
    }
    if (!sameDice(this.activeDice, submission.dice)) {
      throw new RoundSynchronizationError(
        'INVALID_DICE',
        'submitted dice do not match the server dice',
      )
    }
    if (this.submissions.has(submission.playerId)) {
      throw new RoundSynchronizationError(
        'ALREADY_SUBMITTED',
        `player already submitted for round ${this.roundNumber}: ${submission.playerId}`,
      )
    }

    const nextSubmissions = new Map(this.submissions)
    nextSubmissions.set(submission.playerId, submission)
    return this.advance(nextSubmissions)
  }

  /** 무득점으로 턴을 넘긴다(타임아웃·이탈 경로). */
  expire(): RoundSubmissionResult {
    if (this.finished) {
      throw new RoundSynchronizationError(
        'GAME_ALREADY_FINISHED',
        `이미 종료된 게임은 만료 진행할 수 없습니다: round ${this.roundNumber}`,
      )
    }
    return this.advance(this.submissions)
  }

  /**
   * 게임 중 이탈(명시적 나가기·오프라인 자동 퇴장)한 참가자를 턴 순서에서 뺀다.
   *
   * 활성 플레이어는 뺄 수 없다 — 호출자가 먼저 `expire()`로 턴을 넘긴 뒤 불러야
   * 라운드 완료·게임 종료 판정이 기존 진행 경로 하나로 유지된다. 마지막 남은
   * 참가자도 항상 활성이므로 뺄 수 없다 — 그 경우 호출자가 라운드 상태 전체를
   * 버려야 한다. 이미 기록된 제출은 지우지 않는다(점수 이력은 이탈과 무관).
   */
  withoutParticipant(playerId: string): RoundState {
    if (this.finished || !this.participantIds.has(playerId)) {
      return this
    }
    if (this.activePlayerId === playerId) {
      throw new RoundSynchronizationError(
        'INVALID_PLAYER',
        `active player must be advanced past before removal: ${playerId}`,
      )
    }
    const removedIndex = this.participantOrder.indexOf(playerId)
    const nextOrder = [...this.participantOrder]
    nextOrder.splice(removedIndex, 1)
    return new RoundState({
      ...this.props(),
      participantOrder: nextOrder,
      activePlayerIndex:
        removedIndex < this.activePlayerIndex ? this.activePlayerIndex - 1 : this.activePlayerIndex,
      finished: false,
    })
  }

  private advance(currentSubmissions: ReadonlyMap<string, RoundSubmission>): RoundSubmissionResult {
    if (this.activePlayerIndex < this.participantOrder.length - 1) {
      return {
        state: new RoundState({
          ...this.props(),
          submissions: currentSubmissions,
          activePlayerIndex: this.activePlayerIndex + 1,
          activeRollCount: 0,
          activeDice: null,
          activeHeld: null,
          finished: false,
        }),
        completedRound: null,
      }
    }
    return this.complete(currentSubmissions)
  }

  /**
   * 마지막 참가자의 턴이 끝났다. 라운드 상한에 닿았으면 다음 라운드를 만들지 않고
   * 터미널 상태로 전이한다 — 여기서 멈추지 않으면 라운드가 무한히 증가한다.
   */
  private complete(
    completedSubmissions: ReadonlyMap<string, RoundSubmission>,
  ): RoundSubmissionResult {
    const gameCompleted = this.roundNumber >= this.totalRounds
    const completion: RoundCompletion = {
      roundNumber: this.roundNumber,
      submittedPlayerIds: Object.freeze([...completedSubmissions.keys()]),
      nextRoundNumber: gameCompleted ? this.roundNumber : this.roundNumber + 1,
      gameCompleted,
    }
    const state = gameCompleted
      ? new RoundState({
          ...this.props(),
          submissions: completedSubmissions,
          activeRollCount: 0,
          activeDice: null,
          activeHeld: null,
          finished: true,
        })
      : new RoundState({
          ...this.props(),
          roundNumber: this.roundNumber + 1,
          submissions: new Map(),
          activePlayerIndex: 0,
          activeRollCount: 0,
          activeDice: null,
          activeHeld: null,
          finished: false,
        })
    return { state, completedRound: completion }
  }

  private validateCurrentPlayer(playerId: string, submittedRoundNumber: number): void {
    // 종료 판정보다 늦게 도착한 굴림·제출. 라운드 번호가 우연히 맞아도 받지 않는다.
    if (this.finished) {
      throw new RoundSynchronizationError(
        'GAME_ALREADY_FINISHED',
        `이미 종료된 게임입니다: round ${this.roundNumber}/${this.totalRounds}`,
      )
    }
    if (submittedRoundNumber !== this.roundNumber) {
      throw new RoundSynchronizationError(
        'ROUND_MISMATCH',
        `submitted round ${submittedRoundNumber} does not match current round ${this.roundNumber}`,
      )
    }
    if (!this.participantIds.has(playerId)) {
      throw new RoundSynchronizationError(
        'PLAYER_NOT_IN_ROUND',
        `player is not participating in the current round: ${playerId}`,
      )
    }
    if (this.activePlayerId !== playerId) {
      throw new RoundSynchronizationError(
        'NOT_ACTIVE_PLAYER',
        `it is not this player's turn: ${playerId}`,
      )
    }
  }

  private props(): RoundStateProps {
    return {
      roundNumber: this.roundNumber,
      totalRounds: this.totalRounds,
      participantOrder: this.participantOrder,
      submissions: this.submissions,
      activePlayerIndex: this.activePlayerIndex,
      activeRollCount: this.activeRollCount,
      activeDice: this.activeDice,
      activeHeld: this.activeHeld,
      finished: this.finished,
    }
  }
}

const sameDice = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])
