import { z } from 'zod'
import type { GameModuleRegistry, RoomGameHooks } from '../game/module.js'
import type { RoomCloseScheduler } from '../room/closeScheduler.js'
import type { RoomService } from '../room/roomService.js'
import type { RoomSnapshot } from '../room/snapshot.js'
import { SessionAuthenticationError } from '../user/errors.js'
import type { UserService } from '../user/session.js'
import type { RoomBroadcaster } from './broadcaster.js'
import { envelope, type InboundEnvelope } from './envelope.js'
import { toWsPhase, WS_CLOSE_POLICY_VIOLATION, type WsErrorCode } from './protocol.js'
import { type RoomMember, type RoomSessionRegistry, toWsPlayer } from './registry.js'
import type { RealtimeRoomSnapshotService } from './snapshot.js'
import { type ClientSocket, isOpen } from './socket.js'

/**
 * `room.join` — 인증 + 구독. 처리 순서 자체가 계약이다(docs/design/realtime.md 「인증·구독」).
 *
 * 왜 `handler.ts`에서 뺐나: 이 경로 하나가 190줄이고, 그 안의 판정(재시작 뒤 자리 회복,
 * 재접속 vs 최초 참가, 이전 소켓 교체)은 소켓 수명·게임 메시지 라우팅과 성격이 다르다.
 * 여기 모아 두면 "왜 이 순서인가"를 한 번에 읽을 수 있다.
 */

const roomJoinPayloadSchema = z.object({
  roomId: z.string().nullish(),
  nickname: z.string().nullish(),
  sessionToken: z.string().nullish(),
})

type RoomJoinPayload = z.infer<typeof roomJoinPayloadSchema>

export interface Identity {
  readonly playerId: string
  readonly sessionToken: string
  readonly nickname: string
}

export interface JoinDeps {
  readonly broadcaster: RoomBroadcaster
  readonly closeScheduler: RoomCloseScheduler
  readonly games: GameModuleRegistry
  readonly log: {
    info(payload: unknown, message?: string): void
    warn(payload: unknown, message?: string): void
    error(payload: unknown, message?: string): void
  }
  readonly registry: RoomSessionRegistry
  readonly rooms: RoomService
  readonly snapshots: RealtimeRoomSnapshotService
  readonly users: UserService
  readonly send: (socket: ClientSocket, message: ReturnType<typeof envelope>) => void
  readonly sendError: (
    socket: ClientSocket,
    code: WsErrorCode,
    message: string,
    ref?: InboundEnvelope,
  ) => void
  readonly game: (roomId: string) => RoomGameHooks
  readonly broadcastPresence: (
    roomId: string,
    playerId: string,
    status: 'online' | 'away' | 'offline',
  ) => void
}

/**
 * Redis 명단에 이 사람의 자리가 있는지. 좌석 레지스트리(프로세스 메모리)와 달리
 * 재시작을 견디는 근거다 — 재무장한 판으로 돌아오는 판정에 쓴다.
 */
const hasSeat = (room: RoomSnapshot, playerId: string): boolean =>
  room.players.some((player) => player.playerId === playerId)

export async function handleRoomJoin(
  deps: JoinDeps,
  socket: ClientSocket,
  message: InboundEnvelope,
): Promise<void> {
  const request = await admitJoinRequest(deps, socket, message)
  if (request === null) return
  const { roomId, room, identity } = request

  const previous = deps.registry.find(roomId, identity.playerId)
  const playing = deps.registry.phaseOf(roomId) === 'playing'
  /*
   * **재시작 뒤 자기 자리로 돌아오는 경로**(옛 deploy/PLAN.md PR 6).
   *
   * 좌석 레지스트리는 프로세스 메모리라 재시작에 함께 사라진다. 그래서 재접속
   * 판정을 레지스트리만으로 하면, 프로세스가 죽었다 살아난 뒤의 첫 `room.join`이
   * **자기 방인데도 새 참가로 보여 `GAME_ALREADY_STARTED`로 거절된다.** 그러면 마감
   * 시각을 되살려 놓아도 아무도 그 판으로 돌아올 수 없어 재무장이 무의미해진다.
   *
   * 방 명단은 Redis에 있다 — 그것이 "이 사람에게 자리가 있다"의 영속 근거다.
   * 진행 중인 방에만 적용하는 이유: 대기실은 지금도 새 참가로 정상 처리되므로
   * 바꿀 이유가 없고, 바꾸면 `room.joined`·`room.player_joined`가 나가지 않는
   * 차이만 생긴다.
   */
  const reseating = !previous && playing && hasSeat(room, identity.playerId)
  if (playing && !previous && !reseating) {
    deps.sendError(
      socket,
      'GAME_ALREADY_STARTED',
      '이미 시작된 게임에는 새로 참가할 수 없습니다.',
      message,
    )
    return
  }

  const self = deps.registry.join(roomId, socket, identity.playerId, identity.nickname)
  disconnectPreviousSocket(deps, previous, socket)

  // 자리를 되찾는 경우도 재접속 경로다. 최초 참가 경로로 보내면 `resume()`이
  // 불려 **되살린 마감이 새 25초로 덮인다** — 재무장이 헛일이 된다.
  if (previous || reseating) {
    await completeReconnect({ deps, socket, message, roomId, identity })
    return
  }
  await completeFirstJoin({ deps, socket, message, roomId, identity, self })
}

/**
 * 입장 요청의 검증과 신원 확정. 실패하면 **응답을 보내고 null**을 돌려준다.
 *
 * 왜 함수로 뺐나: payload 검증 → 방 존재 → 좌석 등록 → 신원 확인이 한 흐름인데
 * 각 단계가 실패 시 응답을 보내고 빠져나간다. `handleRoomJoin`에 두면 분기마다
 * `return`이 흩어져 "어디까지 통과했나"를 놓치기 쉽다.
 */
async function admitJoinRequest(
  deps: JoinDeps,
  socket: ClientSocket,
  message: InboundEnvelope,
): Promise<{ roomId: string; room: RoomSnapshot; identity: Identity } | null> {
  const parsed = roomJoinPayloadSchema.safeParse(message.payload)
  if (!parsed.success) {
    deps.sendError(socket, 'INVALID_MESSAGE', 'room.join payload가 올바르지 않습니다.', message)
    return null
  }
  const roomId = parsed.data.roomId ?? ''
  if (roomId.trim().length === 0) {
    deps.sendError(socket, 'INVALID_MESSAGE', 'roomId가 필요합니다.', message)
    return null
  }

  // 인메모리 유령 방 방지: Redis에 없는 방에는 아무도 등록하지 않는다.
  const room = await deps.rooms.getSnapshot(roomId)
  if (room.phase === null) {
    deps.sendError(
      socket,
      'ROOM_NOT_FOUND',
      '방이 종료됐습니다. 홈에서 새로 시작해 주세요.',
      message,
    )
    return null
  }
  deps.registry.registerGame(roomId, room.gameCode)
  deps.registry.markPhase(roomId, toWsPhase(room.phase))

  const identity = await resolveJoinIdentity(deps, socket, message, parsed.data)
  return identity === null ? null : { roomId, room, identity }
}

/**
 * 신원 확정 — 만료와 닉네임 오류를 **구분해서** 알린다.
 *
 * 만료를 INVALID_MESSAGE로 뭉개면 클라이언트가 세션 종료로 다루지 않아 대기실에서
 * 안내 없이 멈춘다.
 */
async function resolveJoinIdentity(
  deps: JoinDeps,
  socket: ClientSocket,
  message: InboundEnvelope,
  payload: RoomJoinPayload,
): Promise<Identity | null> {
  try {
    return await resolveIdentity(deps, payload)
  } catch (error) {
    if (error instanceof SessionAuthenticationError) {
      deps.sendError(
        socket,
        'SESSION_EXPIRED',
        '입장 정보가 만료됐습니다. 방에 다시 참가해 주세요.',
        message,
      )
      return null
    }
    deps.sendError(socket, 'INVALID_MESSAGE', '닉네임이 올바르지 않습니다.', message)
    return null
  }
}

/**
 * 재접속: 좌석·host를 유지한 채 소켓만 갈아끼웠다. `room.joined`·`player_joined`는
 * 나가지 않고 스냅샷 하나로 동기화 기준점을 다시 잡는다.
 */
/** 접속 하나의 문맥 — 다섯 값을 위치로 넘기면 어느 것이 무엇인지 읽을 수 없다. */
interface JoinContext {
  readonly deps: JoinDeps
  readonly socket: ClientSocket
  readonly message: InboundEnvelope
  readonly roomId: string
  readonly identity: Identity
}

async function completeReconnect({
  deps,
  socket,
  message,
  roomId,
  identity,
}: JoinContext): Promise<void> {
  const playerId = identity.playerId
  deps.broadcaster.register(roomId, socket)
  let snapshot: unknown
  try {
    snapshot = await deps.game(roomId).reconnect(roomId, playerId)
  } catch (error) {
    deps.log.error({ error, roomId, playerId }, '재접속 상태 스냅샷 생성 실패')
    deps.broadcaster.unregister(socket)
    deps.sendError(
      socket,
      'INTERNAL',
      '게임 상태를 복원하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      message,
    )
    return
  }
  deps.send(socket, envelope('sys.reconnected', { snapshot }, { roomId, msgId: message.msgId }))
  deps.broadcastPresence(roomId, playerId, 'online')
  deps.log.info({ playerId, roomId }, 'room.reconnected')
}

/**
 * 최초 참가: ① 본인에게 `room.joined` → ② 방에 `room.player_joined`(본인은 아직
 * 팬아웃 밖이라 못 받는다) → ③ 팬아웃 등록 → ④ 폐쇄 예약 취소 시 타이머 재개.
 */
async function completeFirstJoin({
  deps,
  socket,
  roomId,
  identity,
  self,
}: JoinContext & { readonly self: RoomMember }): Promise<void> {
  const snapshot = await deps.snapshots.snapshot(roomId)
  deps.send(
    socket,
    envelope(
      'room.joined',
      { you: identity.playerId, sessionToken: identity.sessionToken, snapshot },
      { roomId },
    ),
  )
  deps.broadcaster.broadcast(
    roomId,
    envelope('room.player_joined', { player: toWsPlayer(self) }, { roomId }),
  )
  deps.broadcaster.register(roomId, socket)
  // 취소할 예약이 있었다 = 방금 전까지 아무도 없었다 → 그때 끊어둔 마감 타이머를 다시 건다.
  if (deps.closeScheduler.cancel(roomId)) await deps.game(roomId).resume(roomId)
  deps.log.info({ playerId: identity.playerId, roomId, host: self.host }, 'room.join')
}

/**
 * 신원 확정. `sessionToken`이 있으면 그 세션(payload nickname은 무시),
 * 없으면 새 게스트를 발급한다.
 */
async function resolveIdentity(
  deps: JoinDeps,
  payload: {
    nickname?: string | null | undefined
    sessionToken?: string | null | undefined
  },
): Promise<Identity> {
  const token = payload.sessionToken
  if (token && token.trim().length > 0) {
    const user = await deps.users.authenticateSession(token)
    return { playerId: user.userId, sessionToken: token, nickname: user.nickname }
  }
  const guest = await deps.users.createGuest(payload.nickname)
  return {
    playerId: guest.userId,
    sessionToken: guest.sessionToken,
    nickname: guest.nickname,
  }
}

/** 같은 사람의 이전 소켓은 진다: 팬아웃 해제 → `sys.disconnect` → close 1008. */
function disconnectPreviousSocket(
  deps: JoinDeps,
  previous: RoomMember | null,
  replacement: ClientSocket,
): void {
  const old = previous?.socket
  if (!old || old === replacement) return
  deps.broadcaster.unregister(old)
  if (!isOpen(old)) return
  deps.send(old, envelope('sys.disconnect', { reason: 'replaced_by_new_session' }))
  try {
    old.close(WS_CLOSE_POLICY_VIOLATION)
  } catch (error) {
    deps.log.warn({ error }, '교체된 이전 소켓 정리 실패')
  }
}
