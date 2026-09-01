import { z } from 'zod'
import type { RoomGameHooks } from '../game/module.js'
import type { RoomSnapshot } from '../room/snapshot.js'
import { SessionAuthenticationError } from '../user/errors.js'
import { envelope, type InboundEnvelope } from './envelope.js'
import type { GameSocketHandlerDependencies, WsLogger } from './handler.js'
import {
  type PlayerStatus,
  toWsPhase,
  WS_CLOSE_POLICY_VIOLATION,
  type WsErrorCode,
} from './protocol.js'
import { type RoomMember, toWsPlayer } from './registry.js'
import { type ClientSocket, isOpen } from './socket.js'

const roomJoinPayloadSchema = z.object({
  roomId: z.string().nullish(),
  nickname: z.string().nullish(),
  sessionToken: z.string().nullish(),
})

interface Identity {
  readonly playerId: string
  readonly sessionToken: string
  readonly nickname: string
}

/**
 * Redis 명단에 이 사람의 자리가 있는지. 좌석 레지스트리(프로세스 메모리)와 달리
 * 재시작을 견디는 근거다 — 재무장한 판으로 돌아오는 판정에 쓴다.
 */
const hasSeat = (room: RoomSnapshot, playerId: string): boolean =>
  room.players.some((player) => player.playerId === playerId)

/**
 * `room.join` 한 갈래가 쓰는 협력자들. 게이트웨이 전체를 넘기지 않고 실제로 부르는
 * 것만 받는다 — 이 흐름이 소켓 수명 관리나 게임 메시지 전달에 손대지 않는다는 뜻이
 * 서명에 드러나야 한다.
 */
export interface RoomJoinFlowContext {
  readonly deps: GameSocketHandlerDependencies
  readonly log: WsLogger
  readonly send: (socket: ClientSocket, message: ReturnType<typeof envelope>) => void
  readonly sendError: (
    socket: ClientSocket,
    code: WsErrorCode,
    message: string,
    request?: InboundEnvelope,
  ) => void
  readonly game: (roomId: string) => RoomGameHooks
  readonly broadcastPresence: (roomId: string, playerId: string, status: PlayerStatus) => void
}

/**
 * `room.join`의 인증·구독 흐름. 최초 참가·재접속·자리 되찾기 세 갈래가 여기서
 * 갈리며, 어느 갈래로 가느냐가 곧 계약이다(docs/design/realtime.md 「인증·구독」).
 * 게이트웨이(`GameSocketHandler`)에서 떼어 낸 이유는 이 판정들이 서로만 참조하고
 * 소켓 수명 관리와는 독립이기 때문이다.
 */
export class RoomJoinFlow {
  constructor(private readonly ctx: RoomJoinFlowContext) {}

  /**
   * `room.join` = 인증 + 구독. 처리 순서 자체가 계약이다
   * (docs/design/realtime.md 「인증·구독」).
   */
  async handle(socket: ClientSocket, message: InboundEnvelope): Promise<void> {
    const parsed = roomJoinPayloadSchema.safeParse(message.payload)
    if (!parsed.success) {
      this.ctx.sendError(
        socket,
        'INVALID_MESSAGE',
        'room.join payload가 올바르지 않습니다.',
        message,
      )
      return
    }
    const roomId = parsed.data.roomId ?? ''
    if (roomId.trim().length === 0) {
      this.ctx.sendError(socket, 'INVALID_MESSAGE', 'roomId가 필요합니다.', message)
      return
    }

    // 인메모리 유령 방 방지: Redis에 없는 방에는 아무도 등록하지 않는다.
    const room = await this.ctx.deps.rooms.getSnapshot(roomId)
    if (room.phase === null) {
      this.ctx.sendError(
        socket,
        'ROOM_NOT_FOUND',
        '방이 종료됐습니다. 홈에서 새로 시작해 주세요.',
        message,
      )
      return
    }
    this.ctx.deps.registry.registerGame(roomId, room.gameCode)
    this.ctx.deps.registry.markPhase(roomId, toWsPhase(room.phase))

    let identity: Identity
    try {
      identity = await this.resolveIdentity(parsed.data)
    } catch (error) {
      // 만료를 INVALID_MESSAGE로 뭉개면 클라이언트가 세션 종료로 다루지 않아
      // 대기실에서 안내 없이 멈춘다 — 두 실패는 반드시 구분된다.
      if (error instanceof SessionAuthenticationError) {
        this.ctx.sendError(
          socket,
          'SESSION_EXPIRED',
          '입장 정보가 만료됐습니다. 방에 다시 참가해 주세요.',
          message,
        )
        return
      }
      this.ctx.sendError(socket, 'INVALID_MESSAGE', '닉네임이 올바르지 않습니다.', message)
      return
    }

    const previous = this.ctx.deps.registry.find(roomId, identity.playerId)
    const playing = this.ctx.deps.registry.phaseOf(roomId) === 'playing'
    /*
     * **재시작 뒤 자기 자리로 돌아오는 경로**(deploy/PLAN.md PR 6).
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
      this.ctx.sendError(
        socket,
        'GAME_ALREADY_STARTED',
        '이미 시작된 게임에는 새로 참가할 수 없습니다.',
        message,
      )
      return
    }

    const self = this.ctx.deps.registry.join(roomId, socket, identity.playerId, identity.nickname)
    this.disconnectPreviousSocket(previous, socket)

    // 자리를 되찾는 경우도 재접속 경로다. 최초 참가 경로로 보내면 `resume()`이
    // 불려 **되살린 마감이 새 25초로 덮인다** — 재무장이 헛일이 된다.
    if (previous || reseating) {
      await this.completeReconnect(socket, message, roomId, identity.playerId)
      return
    }
    await this.completeFirstJoin(socket, roomId, identity, self)
  }

  /**
   * 재접속: 좌석·host를 유지한 채 소켓만 갈아끼웠다. `room.joined`·`player_joined`는
   * 나가지 않고 스냅샷 하나로 동기화 기준점을 다시 잡는다.
   */
  private async completeReconnect(
    socket: ClientSocket,
    message: InboundEnvelope,
    roomId: string,
    playerId: string,
  ): Promise<void> {
    this.ctx.deps.broadcaster.register(roomId, socket)
    let snapshot: unknown
    try {
      snapshot = await this.ctx.game(roomId).reconnect(roomId, playerId)
    } catch (error) {
      this.ctx.log.error({ error, roomId, playerId }, '재접속 상태 스냅샷 생성 실패')
      this.ctx.deps.broadcaster.unregister(socket)
      this.ctx.sendError(
        socket,
        'INTERNAL',
        '게임 상태를 복원하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        message,
      )
      return
    }
    this.ctx.send(
      socket,
      envelope('sys.reconnected', { snapshot }, { roomId, msgId: message.msgId }),
    )
    this.ctx.broadcastPresence(roomId, playerId, 'online')
    this.ctx.log.info({ playerId, roomId }, 'room.reconnected')
  }

  /**
   * 최초 참가: ① 본인에게 `room.joined` → ② 방에 `room.player_joined`(본인은 아직
   * 팬아웃 밖이라 못 받는다) → ③ 팬아웃 등록 → ④ 폐쇄 예약 취소 시 타이머 재개.
   */
  private async completeFirstJoin(
    socket: ClientSocket,
    roomId: string,
    identity: Identity,
    self: RoomMember,
  ): Promise<void> {
    const snapshot = await this.ctx.deps.snapshots.snapshot(roomId)
    this.ctx.send(
      socket,
      envelope(
        'room.joined',
        { you: identity.playerId, sessionToken: identity.sessionToken, snapshot },
        { roomId },
      ),
    )
    this.ctx.deps.broadcaster.broadcast(
      roomId,
      envelope('room.player_joined', { player: toWsPlayer(self) }, { roomId }),
    )
    this.ctx.deps.broadcaster.register(roomId, socket)
    // 취소할 예약이 있었다 = 방금 전까지 아무도 없었다 → 그때 끊어둔 마감 타이머를 다시 건다.
    if (this.ctx.deps.closeScheduler.cancel(roomId)) await this.ctx.game(roomId).resume(roomId)
    this.ctx.log.info({ playerId: identity.playerId, roomId, host: self.host }, 'room.join')
  }

  /**
   * 신원 확정. `sessionToken`이 있으면 그 세션(payload nickname은 무시),
   * 없으면 새 게스트를 발급한다.
   */
  private async resolveIdentity(payload: {
    nickname?: string | null | undefined
    sessionToken?: string | null | undefined
  }): Promise<Identity> {
    const token = payload.sessionToken
    if (token && token.trim().length > 0) {
      const user = await this.ctx.deps.users.authenticateSession(token)
      return { playerId: user.userId, sessionToken: token, nickname: user.nickname }
    }
    const guest = await this.ctx.deps.users.createGuest(payload.nickname)
    return {
      playerId: guest.userId,
      sessionToken: guest.sessionToken,
      nickname: guest.nickname,
    }
  }

  /** 같은 사람의 이전 소켓은 진다: 팬아웃 해제 → `sys.disconnect` → close 1008. */
  private disconnectPreviousSocket(previous: RoomMember | null, replacement: ClientSocket): void {
    const old = previous?.socket
    if (!old || old === replacement) return
    this.ctx.deps.broadcaster.unregister(old)
    if (!isOpen(old)) return
    this.ctx.send(old, envelope('sys.disconnect', { reason: 'replaced_by_new_session' }))
    try {
      old.close(WS_CLOSE_POLICY_VIOLATION)
    } catch (error) {
      this.ctx.log.warn({ error }, '교체된 이전 소켓 정리 실패')
    }
  }
}
