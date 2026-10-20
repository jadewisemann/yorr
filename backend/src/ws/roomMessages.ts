import { z } from 'zod'
import type { RoomBroadcaster } from './broadcaster.js'
import { type ChatChannel, chatSendPayloadSchema } from './chat.js'
import { envelope, type InboundEnvelope } from './envelope.js'
import {
  CHAT_TEXT_MAX_LENGTH,
  REACTION_TYPES,
  type ReactionType,
  type WsErrorCode,
} from './protocol.js'
import type { RoomSessionRegistry } from './registry.js'
import type { ClientSocket } from './socket.js'

/**
 * 방 레벨 메시지 — `room.ready` · `reaction.send` · `chat.send`.
 *
 * 왜 `handler.ts`에서 뺐나: 이 셋은 게임과 무관하고, **거절 사유가 곧 계약**이다(빈 줄과
 * 길이 초과는 `INVALID_MESSAGE`, 도배는 `RATE_LIMITED` — 사용자가 고칠 방법이 다르다).
 * 소켓 수명·재접속·방 폐쇄와 섞여 있으면 그 규칙이 어느 함수에 있는지 매번 찾아야 한다.
 */

const roomReadyPayloadSchema = z.object({ ready: z.boolean().nullish() })
const reactionSendPayloadSchema = z.object({ reaction: z.unknown() })

export const isReaction = (value: unknown): value is ReactionType =>
  REACTION_TYPES.includes(value as ReactionType)

export interface RoomMessageDeps {
  readonly broadcaster: RoomBroadcaster
  readonly chat: ChatChannel
  readonly registry: RoomSessionRegistry
  readonly sendError: (
    socket: ClientSocket,
    code: WsErrorCode,
    message: string,
    ref?: InboundEnvelope,
  ) => void
}

export function handleRoomReady(
  deps: RoomMessageDeps,
  socket: ClientSocket,
  message: InboundEnvelope,
) {
  const parsed = roomReadyPayloadSchema.safeParse(message.payload)
  if (!parsed.success) {
    deps.sendError(socket, 'INVALID_MESSAGE', 'room.ready payload가 올바르지 않습니다.', message)
    return
  }
  const me = deps.registry.of(socket)
  if (!me) {
    deps.sendError(socket, 'NOT_IN_ROOM', '방에 입장한 뒤에만 준비할 수 있습니다.', message)
    return
  }
  deps.broadcaster.broadcast(
    me.roomId,
    envelope(
      'room.ready_changed',
      { playerId: me.playerId, ready: parsed.data.ready ?? false },
      { roomId: me.roomId },
    ),
  )
}

/** `reaction.send` → `reaction.broadcast`. 본인도 받는다. 레이트 리밋은 없다. */
export function handleReactionSend(
  deps: RoomMessageDeps,
  socket: ClientSocket,
  message: InboundEnvelope,
) {
  const parsed = reactionSendPayloadSchema.safeParse(message.payload)
  if (!parsed.success) {
    deps.sendError(socket, 'INVALID_MESSAGE', 'reaction.send payload가 올바르지 않습니다.', message)
    return
  }
  const reaction = parsed.data.reaction
  if (reaction === null || reaction === undefined || !isReaction(reaction)) {
    deps.sendError(socket, 'INVALID_MESSAGE', 'reaction 종류가 필요합니다.', message)
    return
  }
  const me = deps.registry.of(socket)
  if (!me) {
    deps.sendError(socket, 'NOT_IN_ROOM', '방에 입장한 뒤에만 리액션을 보낼 수 있습니다.', message)
    return
  }
  deps.broadcaster.broadcast(
    me.roomId,
    envelope('reaction.broadcast', { playerId: me.playerId, reaction }, { roomId: me.roomId }),
  )
}

/**
 * `chat.send` → 방 전원에게 `chat.message`. 거절 사유마다 코드가 갈린다: 빈 줄·길이
 * 초과는 `INVALID_MESSAGE`, 도배는 `RATE_LIMITED`다 — 사용자가 고칠 방법이 다르므로
 * (글을 바꾸는 것과 잠시 기다리는 것) 하나로 뭉개지 않는다.
 *
 * 검사 순서는 다른 방 레벨 메시지와 같다(payload 검증 → 멤버십) — 방 밖에서 깨진
 * payload를 보내면 `NOT_IN_ROOM`이 아니라 `INVALID_MESSAGE`가 나간다.
 */
export function handleChatSend(
  deps: RoomMessageDeps,
  socket: ClientSocket,
  message: InboundEnvelope,
) {
  const parsed = chatSendPayloadSchema.safeParse(message.payload)
  if (!parsed.success) {
    deps.sendError(socket, 'INVALID_MESSAGE', 'chat.send payload가 올바르지 않습니다.', message)
    return
  }
  const me = deps.registry.of(socket)
  if (!me) {
    deps.sendError(socket, 'NOT_IN_ROOM', '방에 입장한 뒤에만 메시지를 보낼 수 있습니다.', message)
    return
  }
  const rejection = deps.chat.send(me, parsed.data.text)
  if (rejection === 'empty') {
    deps.sendError(socket, 'INVALID_MESSAGE', '보낼 내용이 필요합니다.', message)
    return
  }
  if (rejection === 'too_long') {
    deps.sendError(
      socket,
      'INVALID_MESSAGE',
      `메시지는 ${CHAT_TEXT_MAX_LENGTH}자까지 보낼 수 있습니다.`,
      message,
    )
    return
  }
  if (rejection === 'rate_limited') {
    deps.sendError(
      socket,
      'RATE_LIMITED',
      '메시지를 너무 빠르게 보내고 있습니다. 잠시 후 다시 시도해 주세요.',
      message,
    )
  }
}
