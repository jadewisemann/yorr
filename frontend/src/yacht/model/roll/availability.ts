import type { ConnectionStatus } from '@/store'
import type { YachtGameState } from '@/yacht/domain/yachtGame'
import { MAX_ROLLS } from '@/yacht/domain/yachtGame'

export interface RollAvailabilityInput {
  local: YachtGameState
  isMyTurn: boolean
  requestingRoll: boolean
  connectionStatus: ConnectionStatus
}

/**
 * 화면이 쓰는 "지금 무엇을 할 수 있는가". 렌더마다 여러 콜백의 의존성으로 흩어지면
 * 규칙이 바뀔 때 서로 다른 곳을 고쳐야 하고, 게이트의 사이클로매틱도 함께 올라간다 —
 * 판정을 순수 함수 한 곳에 모아 테스트가 직접 확인하게 한다.
 */
export function rollAvailabilityOf(input: RollAvailabilityInput) {
  const { local, isMyTurn, requestingRoll, connectionStatus } = input
  const submitted = local.phase === 'roundComplete'
  const submitting = local.phase === 'submitting'
  const rollsLeft = MAX_ROLLS - local.rollCount
  const keptCount = local.held.filter(Boolean).length
  const allKept = local.dice !== null && keptCount === 5
  const offline = connectionStatus === 'reconnecting' || connectionStatus === 'closed'
  const locked = offline || !isMyTurn
  const canRoll =
    !locked &&
    !submitted &&
    !requestingRoll &&
    !allKept &&
    rollsLeft > 0 &&
    (local.phase === 'ready' || local.phase === 'choosing')
  const rolling = local.phase === 'rolling' || requestingRoll
  const canHold = !locked && !submitted && local.phase === 'choosing' && local.rollCount < MAX_ROLLS
  const canPick = !locked && !submitting && local.phase === 'choosing'
  const lastRollInPlay = local.rollCount >= MAX_ROLLS
  const currentRollNumber =
    local.phase === 'rolling' ? local.rollCount : Math.min(MAX_ROLLS, local.rollCount + 1)
  const settledRollCount = local.phase === 'rolling' ? local.rollCount - 1 : local.rollCount

  return {
    allKept,
    canHold,
    canPick,
    canRoll,
    currentRollNumber,
    keptCount,
    lastRollInPlay,
    locked,
    rolling,
    rollsLeft,
    settledRollCount,
    submitted,
    submitting,
  }
}
