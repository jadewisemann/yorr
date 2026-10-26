/**
 * 라운드 전이 계산. `RoundState`의 인스턴스 메서드가 하던 일을 **순수 함수**로 두어
 * 상태 객체는 검증과 값 보관에만 집중한다. 반환은 항상 새 `RoundState`다.
 */
import { RoundState } from './roundState.js'
import type {
  RoundCompletion,
  RoundStateProps,
  RoundSubmissionResult,
} from './roundStateContracts.js'
import type { RoundSubmission } from './roundSubmission.js'

/** 다음 참가자로 넘기고, 마지막 참가자였으면 라운드를 끝낸다. */
export function advanceTurn(
  props: RoundStateProps,
  submissions: ReadonlyMap<string, RoundSubmission>,
): RoundSubmissionResult {
  if (props.activePlayerIndex < props.participantOrder.length - 1) {
    return {
      state: RoundState.restore({
        ...props,
        submissions,
        activePlayerIndex: props.activePlayerIndex + 1,
        activeRollCount: 0,
        activeDice: null,
        activeHeld: null,
        finished: false,
      }),
      completedRound: null,
    }
  }
  return completeRound(props, submissions)
}

/**
 * 마지막 참가자의 턴이 끝났다. 라운드 상한에 닿았으면 다음 라운드를 만들지 않고
 * 터미널 상태로 전이한다 — 여기서 멈추지 않으면 라운드가 무한히 증가한다.
 */
function completeRound(
  props: RoundStateProps,
  submissions: ReadonlyMap<string, RoundSubmission>,
): RoundSubmissionResult {
  const gameCompleted = props.roundNumber >= props.totalRounds
  const completion: RoundCompletion = {
    roundNumber: props.roundNumber,
    submittedPlayerIds: Object.freeze([...submissions.keys()]),
    nextRoundNumber: gameCompleted ? props.roundNumber : props.roundNumber + 1,
    gameCompleted,
  }
  const terminal = {
    ...props,
    submissions,
    activeRollCount: 0,
    activeDice: null,
    activeHeld: null,
    finished: true,
  }
  const nextRound = {
    ...terminal,
    roundNumber: props.roundNumber + 1,
    submissions: new Map<string, RoundSubmission>(),
    activePlayerIndex: 0,
    finished: false,
  }
  return {
    state: RoundState.restore(gameCompleted ? terminal : nextRound),
    completedRound: completion,
  }
}
