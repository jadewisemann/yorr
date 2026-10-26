import type { InboundEnvelope } from '../../ws/envelope.js'
import type { ClientSocket } from '../../ws/socket.js'
import {
  diceHoldPayloadSchema,
  diceRollPayloadSchema,
  diceShakePayloadSchema,
  diceThrowPayloadSchema,
  roundSubmitPayloadSchema,
  toDiceHoldPayload,
  toDiceRollPayload,
  toDiceShakeRequest,
  toDiceThrowRequest,
  toRoundSubmitPayload,
} from './payloads.js'
import type { YachtBroadcaster, YachtRoundService } from './yachtPorts.js'
import type { YachtTurnActionService } from './yachtTurnActionService.js'
import { yachtWsType } from './yachtWsTypes.js'

/**
 * 야추 인바운드 5메시지 — `dice.roll` · `dice.hold` · `dice.shake` · `dice.throw` ·
 * `round.submit`.
 *
 * 왜 분리했나: 다섯 핸들러가 공유하는 계약이 하나 있다 — **payload 검증이 멤버십·턴
 * 판정보다 먼저**이고, `dice.shake`만 비활성 플레이어를 무음으로 버린다(고빈도 신호라
 * 오류를 쏟지 않는다). 그 비대칭을 한 파일에 모아 두면 계약이 눈에 보인다.
 */

export interface Seat {
  readonly playerId: string
  readonly roomId: string
}

export interface InboundDeps {
  readonly actions: YachtTurnActionService
  readonly broadcaster: YachtBroadcaster
  readonly now: () => number
  readonly rounds: YachtRoundService
  readonly seatOf: (socket: ClientSocket, message: InboundEnvelope) => Seat | null
  readonly sendError: (
    socket: ClientSocket,
    code: 'INVALID_MESSAGE' | 'NOT_YOUR_TURN' | 'NOT_IN_ROOM',
    text: string,
    request: InboundEnvelope,
  ) => void
  readonly sendDomainError: (socket: ClientSocket, message: InboundEnvelope, error: unknown) => void
}

export async function handleRoll(
  deps: InboundDeps,
  socket: ClientSocket,
  message: InboundEnvelope,
): Promise<void> {
  const seat = deps.seatOf(socket, message)
  if (seat === null) return
  const parsed = diceRollPayloadSchema.safeParse(message.payload)
  if (!parsed.success) {
    deps.sendError(socket, 'INVALID_MESSAGE', 'dice.roll payload가 올바르지 않습니다.', message)
    return
  }
  try {
    await deps.actions.roll(
      seat.roomId,
      seat.playerId,
      toDiceRollPayload(parsed.data),
      message.msgId ?? null,
    )
  } catch (error) {
    deps.sendDomainError(socket, message, error)
  }
}

export async function handleHold(
  deps: InboundDeps,
  socket: ClientSocket,
  message: InboundEnvelope,
): Promise<void> {
  const seat = deps.seatOf(socket, message)
  if (seat === null) return
  const parsed = diceHoldPayloadSchema.safeParse(message.payload)
  if (!parsed.success) {
    deps.sendError(socket, 'INVALID_MESSAGE', 'dice.hold payload가 올바르지 않습니다.', message)
    return
  }
  try {
    await deps.actions.hold(
      seat.roomId,
      seat.playerId,
      toDiceHoldPayload(parsed.data),
      message.msgId ?? null,
    )
  } catch (error) {
    deps.sendDomainError(socket, message, error)
  }
}

/**
 * `dice.shake` → `dice.shaken` 순수 연출 릴레이. 라운드 상태를 건드리지 않는다.
 *
 * **비활성 플레이어에게는 아무 응답도 주지 않는다**(무음 드롭). 방향이 바뀔 때마다
 * 올라오는 고빈도 메시지라, 턴이 넘어가는 찰나에 남은 펄스가 몇 개 도착하는 것이
 * 정상이다 — 매번 오류를 돌려주면 그 순간 오류만 쏟아진다. `dice.throw`와의 이
 * **비대칭이 계약**이다(docs/design/games/yacht.md).
 *
 * payload 검증이 활성 판정보다 **먼저**다: 남의 턴에 깨진 shake를 보내면 무음이
 * 아니라 `INVALID_MESSAGE`가 나간다.
 */
export async function handleShake(
  deps: InboundDeps,
  socket: ClientSocket,
  message: InboundEnvelope,
): Promise<void> {
  const seat = deps.seatOf(socket, message)
  if (seat === null) return
  const parsed = diceShakePayloadSchema.safeParse(message.payload)
  if (!parsed.success) {
    deps.sendError(socket, 'INVALID_MESSAGE', 'dice.shake payload가 올바르지 않습니다.', message)
    return
  }
  if (!(await isActivePlayer(deps, seat))) return
  const payload = toDiceShakeRequest(parsed.data)
  deps.broadcaster.broadcast(seat.roomId, {
    type: yachtWsType('dice.shaken'),
    ts: deps.now(),
    payload: {
      playerId: seat.playerId,
      roundNumber: payload.roundNumber,
      direction: payload.direction,
      strength: payload.strength,
    },
    roomId: seat.roomId,
    msgId: message.msgId ?? undefined,
  })
}

/**
 * `dice.throw` → `dice.thrown` 순수 연출 릴레이("지금 쏟아라"). 주사위 눈은
 * `dice.roll`에서 이미 확정됐으므로 상태를 건드리지 않고, 유실돼도 진행은 어긋나지
 * 않는다.
 *
 * shake와 달리 비활성 플레이어에게는 `NOT_YOUR_TURN`을 돌려준다 — **남의 그릇을
 * 대신 엎는** 신호라 조용히 버리면 안 된다.
 */
export async function handleThrow(
  deps: InboundDeps,
  socket: ClientSocket,
  message: InboundEnvelope,
): Promise<void> {
  const seat = deps.seatOf(socket, message)
  if (seat === null) return
  const parsed = diceThrowPayloadSchema.safeParse(message.payload)
  if (!parsed.success) {
    deps.sendError(socket, 'INVALID_MESSAGE', 'dice.throw payload가 올바르지 않습니다.', message)
    return
  }
  if (!(await isActivePlayer(deps, seat))) {
    deps.sendError(socket, 'NOT_YOUR_TURN', '현재 턴의 플레이어만 던질 수 있습니다.', message)
    return
  }
  const payload = toDiceThrowRequest(parsed.data)
  deps.broadcaster.broadcast(seat.roomId, {
    type: yachtWsType('dice.thrown'),
    ts: deps.now(),
    payload: {
      playerId: seat.playerId,
      roundNumber: payload.roundNumber,
      rollCount: payload.rollCount,
    },
    roomId: seat.roomId,
    msgId: message.msgId ?? undefined,
  })
}

export async function handleSubmit(
  deps: InboundDeps,
  socket: ClientSocket,
  message: InboundEnvelope,
): Promise<void> {
  const seat = deps.seatOf(socket, message)
  if (seat === null) return
  const parsed = roundSubmitPayloadSchema.safeParse(message.payload)
  if (!parsed.success) {
    deps.sendError(socket, 'INVALID_MESSAGE', 'round.submit payload가 올바르지 않습니다.', message)
    return
  }
  try {
    await deps.actions.submitScore(
      seat.roomId,
      seat.playerId,
      toRoundSubmitPayload(parsed.data),
      message.msgId ?? null,
    )
  } catch (error) {
    deps.sendDomainError(socket, message, error)
  }
}

/**
 * 라운드 상태가 없으면 "활성 아님"이다 — 게임이 시작되기 전이나 끝난 뒤의 연출
 * 신호가 릴레이되지 않는다.
 */
async function isActivePlayer(deps: InboundDeps, seat: Seat): Promise<boolean> {
  const state = await deps.rounds.findByRoomId(seat.roomId)
  return state !== undefined && state.activePlayerId === seat.playerId
}
