import type { RoundState } from '../../round/index.js'

/**
 * 봇 코디네이터의 **턴 동일성 판정** — "예약될 때 본 상태"와 "지금 상태"가 같은
 * 턴의 같은 순간인가.
 *
 * dice·held까지 보는 이유: rollCount가 같아도 사람이 킵을 바꿨거나(hold) 마감
 * 자동 굴림이 끼어들었으면 봇의 결정 근거가 이미 낡았다.
 *
 * 코디네이터(`yachtBotTurnCoordinator.ts`)에서 갈라 둔 이유: 이 판정은 비교 함수
 * 넷뿐이고 상태를 바꾸지 않는다. 코디네이터는 "무엇을 할지"를 정한다.
 */

/** 예약 시점과 지금이 **정확히 같은 순간**인가 — 봇이 움직여도 되는가. */
export const sameTurnVersion = (scheduled: RoundState, current: RoundState): boolean =>
  scheduled.roundNumber === current.roundNumber &&
  scheduled.activePlayerId === current.activePlayerId &&
  scheduled.activeRollCount === current.activeRollCount &&
  sameNumbers(scheduled.activeDice, current.activeDice) &&
  sameHeld(scheduled.activeHeld, current.activeHeld)

/** 킵을 그대로 쓰고 다음 굴림으로 갈 때의 재확인 — dice·held는 보지 않는다. */
export const sameTurn = (before: RoundState, current: RoundState): boolean =>
  !current.finished &&
  current.roundNumber === before.roundNumber &&
  current.activePlayerId === before.activePlayerId &&
  current.activeRollCount === before.activeRollCount

export const sameNumbers = (
  left: readonly number[] | null,
  right: readonly number[] | null,
): boolean => {
  if (left === null || right === null) return left === right
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export const sameHeld = (
  left: readonly boolean[] | null,
  right: readonly boolean[] | null,
): boolean => {
  if (left === null || right === null) return left === right
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/** roster에서 활성 플레이어를 찾고 **그것이 봇일 때만** id를 준다. */
export const activeBotId = (
  room: {
    readonly players: readonly { readonly playerId: string; readonly kind: string }[]
  } | null,
  activePlayerId: string,
): string | null => {
  const player = room?.players.find((entry) => entry.playerId === activePlayerId)
  if (player === undefined || player.kind !== 'BOT') return null
  return player.playerId
}
