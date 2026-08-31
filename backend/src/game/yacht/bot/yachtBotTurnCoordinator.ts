import { MAX_ROLL_COUNT, type RoundStartedEvent, type RoundState } from '../../round/index.js'
import { SCORE_CATEGORIES, type ScoreBoard } from '../../score/index.js'
import type {
  YachtBotActions,
  YachtBotFallbackStrategy,
  YachtBotPolicy,
  YachtBotRoomService,
  YachtBotRoundLookup,
  YachtBotScoreLookup,
} from './botPorts.js'
import type { BotDecision } from './expectimaxYachtBotPolicy.js'
import { holdDecision, scoreDecision } from './expectimaxYachtBotPolicy.js'

const NO_HELD: readonly boolean[] = Object.freeze([false, false, false, false, false])
const FACE_COUNT = 6

/**
 * 봇 턴 한 **스텝**의 결과 — Java `YachtBotTurnCoordinator.BotTurnStep` record.
 *
 * `state`는 그 스텝이 만든 상태다(무시된 스텝은 null). 오케스트레이터는 이것만 보고
 * ① `dice.thrown` 연출을 예약할지 ② 같은 턴을 이어갈지 판단한다.
 */
export interface BotTurnStep {
  readonly acted: boolean
  readonly continueAfterObservation: boolean
  readonly state: RoundState | null
}

const ignoredStep: BotTurnStep = Object.freeze({
  acted: false,
  continueAfterObservation: false,
  state: null,
})
const completedStep = (state: RoundState): BotTurnStep => ({
  acted: true,
  continueAfterObservation: false,
  state,
})
const observationStep = (state: RoundState): BotTurnStep => ({
  acted: true,
  continueAfterObservation: true,
  state,
})

export interface YachtBotTurnCoordinatorDeps {
  readonly rounds: YachtBotRoundLookup
  readonly actions: YachtBotActions
  readonly policy: YachtBotPolicy
  readonly strategy: YachtBotFallbackStrategy
  readonly rooms: YachtBotRoomService
  readonly scores: YachtBotScoreLookup
}

export interface YachtBotTurnCoordinatorOptions {
  /** Java `log.warn` 자리 — Expectimax 실패로 폴백했을 때의 관측 훅. */
  readonly onPolicyFallback?: (roomId: string, state: RoundState, error: unknown) => void
}

/**
 * 봇 턴의 **한 스텝을 원자적으로** 실행한다.
 *
 * 두 가지가 이 클래스의 전부다:
 *
 * 1. **스테일 판정.** 예약될 때 본 상태(`event.state`)와 지금 저장소의 상태가
 * TurnVersion(라운드·활성자·rollCount·dice·held)까지 같아야 움직인다. 다르면
 * 그 사이에 사람이 뭔가 했거나 타임아웃이 턴을 넘긴 것이므로 **조용히 무시**한다.
 * 2. **사람과 같은 경로.** 굴림·킵·제출을 전부 `YachtTurnActionService`로 보낸다.
 * 별도 경로를 만들면 "봇만 점수가 안 들어간다" 같은 갈라짐이 생긴다.
 */
export class YachtBotTurnCoordinator {
  private readonly rounds: YachtBotRoundLookup
  private readonly actions: YachtBotActions
  private readonly policy: YachtBotPolicy
  private readonly strategy: YachtBotFallbackStrategy
  private readonly rooms: YachtBotRoomService
  private readonly scores: YachtBotScoreLookup
  private readonly onPolicyFallback: (roomId: string, state: RoundState, error: unknown) => void

  constructor(deps: YachtBotTurnCoordinatorDeps, options: YachtBotTurnCoordinatorOptions = {}) {
    this.rounds = deps.rounds
    this.actions = deps.actions
    this.policy = deps.policy
    this.strategy = deps.strategy
    this.rooms = deps.rooms
    this.scores = deps.scores
    this.onPolicyFallback = options.onPolicyFallback ?? (() => {})
  }

  /** `executeIfCurrent`의 boolean 축약 — Java와 같이 통합 테스트가 쓴다. */
  async playIfCurrent(event: RoundStartedEvent): Promise<boolean> {
    return (await this.executeIfCurrent(event)).acted
  }

  async executeIfCurrent(event: RoundStartedEvent): Promise<BotTurnStep> {
    const state = await this.rounds.findByRoomId(event.roomId)
    if (state === undefined || state.finished || !sameTurnVersion(event.state, state)) {
      return ignoredStep
    }

    const room = await this.rooms.getSnapshot(event.roomId)
    const gameId = room?.gameId ?? null
    if (gameId === null || gameId.trim().length === 0) return ignoredStep
    const botId = activeBotId(room, state.activePlayerId)
    if (botId === null) return ignoredStep

    // 턴 시작(굴림 0회)에는 결정할 것이 없다 — 무조건 한 번 굴려야 주사위가 생긴다.
    // 여기서 정책을 부르면 아직 없는 주사위로 탐색하게 된다.
    if (state.activeRollCount === 0) {
      const rolled = await this.actions.roll(
        event.roomId,
        botId,
        { roundNumber: state.roundNumber, rollCount: 1, held: NO_HELD },
        null,
      )
      return completedStep(rolled)
    }

    const dice = state.activeDice
    // rollCount ≥ 1이면 항상 주사위가 있다. 손상된 스냅샷 방어(도달하면 타이머 폴백).
    if (dice === null) return ignoredStep

    const board = await this.scores.scoreBoard(gameId, botId)
    const decision = await this.decide(event.roomId, board, state, dice)

    if (decision.action === 'SCORE' || state.activeRollCount === MAX_ROLL_COUNT) {
      return this.submit(event.roomId, gameId, botId, state, dice, decision)
    }
    if (state.activeRollCount < MAX_ROLL_COUNT) {
      return this.holdOrRoll(event.roomId, botId, state, dice, decision)
    }
    return ignoredStep
  }

  /** 점수 확정으로 턴을 마무리한다. 카테고리가 없으면 폴백 전략이 고른다. */
  private async submit(
    roomId: string,
    gameId: string,
    botId: string,
    state: RoundState,
    dice: readonly number[],
    decision: BotDecision,
  ): Promise<BotTurnStep> {
    const category =
      decision.category ??
      this.strategy.chooseCategory(dice, await this.scores.openCategories(gameId, botId))
    await this.actions.submitScore(
      roomId,
      botId,
      { roundNumber: state.roundNumber, dice: [...dice], category },
      null,
    )
    // 제출은 턴을 넘기므로 이 스텝이 만든 "봇의 상태"는 없다. Java도 제출 **전**
    // 상태를 그대로 돌려준다 — 오케스트레이터의 isRollStep이 rollCount+1을 요구하므로
    // 이 값으로는 `dice.thrown`이 예약되지 않는다.
    return completedStep(state)
  }

  /** 킵을 바꿔야 하면 바꾸고 관찰로 돌아가고, 이미 맞으면 바로 다음 굴림으로 간다. */
  private async holdOrRoll(
    roomId: string,
    botId: string,
    state: RoundState,
    dice: readonly number[],
    decision: BotDecision,
  ): Promise<BotTurnStep> {
    const held = preserveHeldDiceIdentity(dice, state.activeHeld, decision.held)
    // 킵이 이미 원하는 모양이면 hold 이벤트를 내지 않는다 — 같은 값을 다시 보내면
    // 프론트에 의미 없는 hold_changed가 한 번 더 간다.
    if (!sameHeld(held, state.activeHeld)) {
      const heldState = await this.actions.hold(
        roomId,
        botId,
        { roundNumber: state.roundNumber, held },
        null,
      )
      return observationStep(heldState)
    }
    // 킵을 그대로 쓰고 바로 다음 굴림으로 간다. 그 사이에 상태가 바뀌었을 수 있으니
    // (사람의 요청·타임아웃) rollCount를 **다시 읽어** 연속성을 맞춘다.
    const current = await this.rounds.findByRoomId(roomId)
    if (current === undefined || !sameTurn(state, current)) return ignoredStep
    const rolled = await this.actions.roll(
      roomId,
      botId,
      { roundNumber: current.roundNumber, rollCount: current.activeRollCount + 1, held },
      null,
    )
    return completedStep(rolled)
  }

  /**
   * 주 정책 → 실패하면 폴백. **예외를 여기서 흡수하는 것이 계약이다** — 탐색이
   * 실패했다고 봇이 턴을 멈추면 방 전체가 25초 타임아웃을 기다린다.
   */
  private async decide(
    roomId: string,
    board: ScoreBoard,
    state: RoundState,
    dice: readonly number[],
  ): Promise<BotDecision> {
    try {
      return await this.policy.decide(board, dice, state.activeRollCount)
    } catch (error) {
      this.onPolicyFallback(roomId, state, error)
      const open = SCORE_CATEGORIES.filter((category) => board.categories[category] === null)
      if (state.activeRollCount === MAX_ROLL_COUNT) {
        return scoreDecision(this.strategy.chooseCategory(dice, open), 0)
      }
      const held = this.strategy.chooseHeld(dice)
      // 폴백 전략이 "다섯 개 다 킵"을 말했다면 그것은 리롤이 아니라 제출이다
      // (Expectimax가 전체 킵을 후보에서 뺀 것과 같은 이유).
      if (held.every((flag) => flag)) {
        return scoreDecision(this.strategy.chooseCategory(dice, open), 0)
      }
      return holdDecision(held, 0)
    }
  }
}

/**
 * 원하는 킵을 **면 개수 기준**으로 재해석해 이미 킵된 주사위를 그대로 둔다.
 *
 * 정책은 "6을 두 개 남긴다"까지만 말하고 어느 자리인지는 신경 쓰지 않는다. 그런데
 * 자리를 바꿔서 보내면 값은 같은데 `dice.hold_changed`가 한 번 더 나가고, 프론트에서는
 * 주사위가 이유 없이 풀렸다 다시 잡힌다. 그래서 **이미 잡혀 있는 자리에 우선권**을 준다.
 */
const preserveHeldDiceIdentity = (
  dice: readonly number[],
  currentHeld: readonly boolean[] | null,
  desiredHeld: readonly boolean[],
): readonly boolean[] => {
  if (
    currentHeld === null ||
    currentHeld.length !== dice.length ||
    desiredHeld.length !== dice.length
  ) {
    return desiredHeld
  }

  const remainingByFace = new Array<number>(FACE_COUNT).fill(0)
  for (let index = 0; index < dice.length; index += 1) {
    if (desiredHeld[index] === true) {
      const face = faceIndexOf(dice, index)
      remainingByFace[face] = (remainingByFace[face] ?? 0) + 1
    }
  }

  const resolved = new Array<boolean>(dice.length).fill(false)
  // 1차: 지금 잡혀 있는 자리부터 채운다(같은 면이면 그 자리를 유지).
  claimQuota(dice, resolved, remainingByFace, (index) => currentHeld[index] === true)
  // 2차: 남은 몫을 앞자리부터 채운다.
  claimQuota(dice, resolved, remainingByFace, () => true)
  return Object.freeze(resolved)
}

const faceIndexOf = (dice: readonly number[], index: number): number => (dice[index] ?? 1) - 1

/**
 * `eligible`인 자리부터 면별 남은 몫을 소비해 `resolved`를 켠다. 두 번 호출되며
 * (① 이미 킵된 자리 ② 남은 자리) 그 순서가 "자리 유지" 규칙의 전부다.
 */
const claimQuota = (
  dice: readonly number[],
  resolved: boolean[],
  remainingByFace: number[],
  eligible: (index: number) => boolean,
): void => {
  for (let index = 0; index < dice.length; index += 1) {
    const face = faceIndexOf(dice, index)
    if (resolved[index] || !eligible(index)) continue
    if ((remainingByFace[face] ?? 0) <= 0) continue
    resolved[index] = true
    remainingByFace[face] = (remainingByFace[face] ?? 0) - 1
  }
}

/**
 * Java `TurnVersion.matches` — 예약 시점의 상태와 지금 상태가 **같은 턴의 같은 순간**인지.
 *
 * dice·held까지 보는 이유: rollCount가 같아도 사람이 킵을 바꿨거나(hold) 마감
 * 자동 굴림이 끼어들었으면 봇의 결정 근거가 이미 낡았다.
 */
const sameTurnVersion = (scheduled: RoundState, current: RoundState): boolean =>
  scheduled.roundNumber === current.roundNumber &&
  scheduled.activePlayerId === current.activePlayerId &&
  scheduled.activeRollCount === current.activeRollCount &&
  sameNumbers(scheduled.activeDice, current.activeDice) &&
  sameHeld(scheduled.activeHeld, current.activeHeld)

/** 킵을 그대로 쓰고 다음 굴림으로 갈 때의 재확인 — dice·held는 보지 않는다. */
const sameTurn = (before: RoundState, current: RoundState): boolean =>
  !current.finished &&
  current.roundNumber === before.roundNumber &&
  current.activePlayerId === before.activePlayerId &&
  current.activeRollCount === before.activeRollCount

const sameNumbers = (left: readonly number[] | null, right: readonly number[] | null): boolean => {
  if (left === null || right === null) return left === right
  return left.length === right.length && left.every((value, index) => value === right[index])
}

const sameHeld = (left: readonly boolean[] | null, right: readonly boolean[] | null): boolean => {
  if (left === null || right === null) return left === right
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/** roster에서 활성 플레이어를 찾고 **그것이 봇일 때만** id를 준다. */
const activeBotId = (
  room: {
    readonly players: readonly { readonly playerId: string; readonly kind: string }[]
  } | null,
  activePlayerId: string,
): string | null => {
  const player = room?.players.find((entry) => entry.playerId === activePlayerId)
  if (player === undefined || player.kind !== 'BOT') return null
  return player.playerId
}
