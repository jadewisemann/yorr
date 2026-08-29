import {
  DAVINCI_JOKER,
  type DavinciTile,
  type DavinciView,
  type PlayerId,
} from '@/realtime/wsEvents'

/**
 * 다빈치 코드의 파생 계산 — 서버가 내려준 시점(`DavinciView`)만 읽는 순수 함수다.
 * 판정은 전부 서버가 하므로(DESIGN.md 원칙 1) 여기서 규칙을 다시 구현하지 않는다.
 * 이 파일이 만드는 것은 **화면이 물어보는 질문에 대한 답**뿐이다.
 */

/** 부를 수 있는 숫자 — 0~11과 조커. 숫자 패드의 순서이기도 하다. */
export const GUESSABLE_NUMBERS: readonly number[] = [
  ...Array.from({ length: 12 }, (_, number) => number),
  DAVINCI_JOKER,
]

/** 타일에 찍히는 글자. 아직 아무도 못 맞힌 타일은 물음표다. */
export function tileLabel(tile: Pick<DavinciTile, 'number'>): string {
  if (tile.number === null) return '?'
  return tile.number === DAVINCI_JOKER ? 'J' : String(tile.number)
}

/** 숫자 패드 버튼에 찍히는 글자. 타일과 달리 감춰진 값이 없다. */
export function numberLabel(value: number): string {
  return value === DAVINCI_JOKER ? '조커' : String(value)
}

export function isMyTurn(state: DavinciView | undefined, you: PlayerId): boolean {
  return state?.turnPlayerId === you && state.phase !== 'FINISHED'
}

export function isEliminated(state: DavinciView | undefined, playerId: PlayerId): boolean {
  return state?.eliminated.includes(playerId) ?? false
}

/** 아직 감춰진 타일 수 — 그대로 "몇 개 더 맞혀야 하는가"다. */
export function hiddenCount(state: DavinciView | undefined, playerId: PlayerId): number {
  return (state?.hands[playerId] ?? []).filter((tile) => !tile.revealed).length
}

/**
 * 판이 끝난 뒤의 점수 — **맞힌 수 + 끝까지 감춘 수**(서버 `scoreOf`와 같은 식).
 *
 * 서버가 점수판에 쓰는 값과 같은 계산을 화면에서도 하는 이유는, 결과 화면이 방
 * 스냅샷이 아니라 마지막 게임 시점만 들고 그려지기 때문이다. 규칙이 아니라 표시용
 * 합계이므로 서버 권위와 어긋날 여지가 없다.
 */
export function scoreOf(state: DavinciView | undefined, playerId: PlayerId): number {
  return (state?.hits[playerId] ?? 0) + hiddenCount(state, playerId)
}

/** 내가 지목할 수 있는 상대 — 탈락자와 나 자신은 빠진다. */
export function opponentsOf(state: DavinciView | undefined, you: PlayerId): PlayerId[] {
  return (state?.playerOrder ?? []).filter(
    (playerId) => playerId !== you && !isEliminated(state, playerId),
  )
}

export function canTarget(
  state: DavinciView | undefined,
  you: PlayerId,
  playerId: PlayerId,
  tile: DavinciTile,
): boolean {
  return isMyTurn(state, you) && state?.phase === 'GUESSING' && playerId !== you && !tile.revealed
}

export type DavinciPrompt =
  | 'guess'
  | 'decide'
  | 'place'
  | 'wait'
  | 'eliminated'
  | 'finished'
  | 'loading'

/** 지금 화면이 사람에게 요구하는 것 하나. 하단 패널이 이 값으로 갈린다. */
export function promptOf(state: DavinciView | undefined, you: PlayerId): DavinciPrompt {
  if (!state) return 'loading'
  if (state.phase === 'FINISHED') return 'finished'
  if (isEliminated(state, you)) return 'eliminated'
  if (!isMyTurn(state, you)) return 'wait'
  if (state.phase === 'DECIDING') return 'decide'
  if (state.phase === 'PLACING') return 'place'
  return 'guess'
}

/** 직전에 일어난 일 한 줄. 화면 위쪽 알림 자리에 그대로 들어간다. */
export function lastEventMessage(
  state: DavinciView | undefined,
  nameOf: (playerId: PlayerId) => string,
): string | null {
  const event = state?.lastEvent
  if (!event) return null
  if (event.kind === 'FORFEIT') return `${nameOf(event.actorId)} 님이 판을 떠났어요.`
  if (event.kind === 'TIMEOUT') return `${nameOf(event.actorId)} 님이 시간을 넘겼어요.`
  const number = event.number === DAVINCI_JOKER ? '조커' : String(event.number ?? '')
  const target = nameOf(event.targetId ?? '')
  return event.correct
    ? `${nameOf(event.actorId)} 님이 ${target}의 ${number}을(를) 맞혔어요.`
    : `${nameOf(event.actorId)} 님이 ${target}에게 ${number}을(를) 불렀지만 틀렸어요.`
}
