import { randomInt } from 'node:crypto'
import { ConflictError, DomainError } from '../../errors.js'
import { DAVINCI_DECK_SIZE, DAVINCI_MAX_PLAYERS, DAVINCI_MIN_PLAYERS } from './davinciRules.js'

/**
 * 다빈치 코드의 **입력 검증과 시작 명단, 덱 섞기** — 상태도 포트도 모르는 순수 조각.
 *
 * 서비스(`davinciGameService.ts`)에서 갈라 둔 이유: 검증은 "무엇이 유효한 입력인가"만
 * 알고, 서비스는 "그 입력으로 판을 어떻게 진행하는가"를 안다. 한 파일에 두면 검증
 * 규칙을 바꿀 때 진행 로직을 지나쳐야 한다.
 */

/** 시작 시점의 참가자 명단. `room/snapshot.ts`의 `RoomSnapshot`이 그대로 만족한다. */
export interface DavinciStartRoster {
  readonly hostId: string | null
  readonly players: readonly { readonly playerId: string; readonly kind: string }[]
}

/** 입력 번호는 0 이상의 정수여야 한다 — 재전송 판별의 기준이다. */
export const requireInputSeq = (inputSeq: number): void => {
  if (!Number.isInteger(inputSeq) || inputSeq < 0) throw new DomainError('invalid_davinci_input')
}

/** 추측 payload 검증 — 빈 id는 규칙에 닿기 전에 거절한다. */
export const requireGuessPayload = (payload: {
  readonly inputSeq: number
  readonly targetId: string
  readonly tileId: string
}): void => {
  requireInputSeq(payload.inputSeq)
  if (payload.targetId.trim().length === 0 || payload.tileId.trim().length === 0) {
    throw new DomainError('invalid_davinci_guess')
  }
}

/** 선택 payload 검증. */
export const requireDecidePayload = (payload: {
  readonly inputSeq: number
  readonly decision: string
}): void => {
  requireInputSeq(payload.inputSeq)
  if (payload.decision !== 'CONTINUE' && payload.decision !== 'STOP') {
    throw new DomainError('invalid_davinci_decision')
  }
}

/** 조커 배치 payload 검증. */
export const requirePlacePayload = (payload: {
  readonly inputSeq: number
  readonly index: number
}): void => {
  requireInputSeq(payload.inputSeq)
  if (!Number.isInteger(payload.index) || payload.index < 0) {
    throw new DomainError('invalid_davinci_place')
  }
}

/**
 * 시작 명단 — **호스트가 `playerOrder[0]`** 이고 첫 턴을 가진다. 봇은 걸러낸다.
 *
 * 카탈로그가 `supportsBots: false`로 막지만 여기서 한 번 더 확인해 2~4인이 아니면
 * 시작을 거절한다(라이프사이클이 그 예외로 START를 롤백한다).
 */
export const orderedPlayerIds = (roster: DavinciStartRoster): string[] => {
  const humans = roster.players.filter((player) => player.kind === 'HUMAN')
  const players = [
    ...humans.filter((player) => player.playerId === roster.hostId),
    ...humans.filter((player) => player.playerId !== roster.hostId),
  ].map((player) => player.playerId)
  if (players.length < DAVINCI_MIN_PLAYERS || players.length > DAVINCI_MAX_PLAYERS) {
    throw new ConflictError('davinci_requires_two_to_four_players')
  }
  return players
}

/** 0~25의 순열. Fisher–Yates에 `crypto.randomInt`를 쓴다(예측 가능한 섞기 금지). */
export const shuffledDeckOrder = (): readonly number[] => {
  const order = Array.from({ length: DAVINCI_DECK_SIZE }, (_, index) => index)
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1)
    const left = order[index] as number
    const right = order[swap] as number
    order[index] = right
    order[swap] = left
  }
  return order
}
