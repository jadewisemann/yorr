import { z } from 'zod'
import type { GameModuleRegistry, RoomGameHooks } from '../game/module.js'
import type { RoomCloseScheduler } from '../room/closeScheduler.js'
import type { RoomService } from '../room/roomService.js'
import type { RoomSnapshot } from '../room/snapshot.js'
import { SessionAuthenticationError } from '../user/errors.js'
import type { UserService } from '../user/session.js'
import type { RoomBroadcaster } from './broadcaster.js'
import { ChatChannel, chatSendPayloadSchema } from './chat.js'
import { ControllerSignalChannel, controllerSignalPayloadSchema } from './controllerSignal.js'
import { envelope, type InboundEnvelope, parseInbound } from './envelope.js'
import type { HeartbeatMonitor } from './heartbeat.js'
import {
  CHAT_TEXT_MAX_LENGTH,
  HEARTBEAT_INTERVAL_MS,
  type PlayerStatus,
  REACTION_TYPES,
  type ReactionType,
  toWsPhase,
  WS_CLOSE_POLICY_VIOLATION,
  WS_PROTOCOL_VERSION,
  type WsErrorCode,
} from './protocol.js'
import { type RoomMember, type RoomSessionRegistry, toWsPlayer } from './registry.js'
import type { RealtimeRoomSnapshotService } from './snapshot.js'
import { type ClientSocket, isOpen } from './socket.js'

/**
 * 마지막 참가자의 소켓이 끊긴 뒤 **대기실**을 닫기까지의 유예.
 * 새로고침·터널 통과 같은 짧은 단절의 왕복이 끝날 만큼만 준다.
 */
export const EMPTY_LOBBY_GRACE_MS = 30_000

/**
 * **진행 중인 게임**이 비었을 때의 유예. 여기서 닫으면 점수판·라운드 진행처럼
 * 되돌릴 수 없는 값이 사라지고, 모바일의 앱 전환·화면 잠금·전화 수신은 30초를
 * 쉽게 넘긴다. 방 TTL(40분)이 상한이라 그보다 길게 잡을 이유는 없다.
 */
export const ACTIVE_GAME_GRACE_MS = 10 * 60 * 1000

export interface WsLogger {
  info(payload: unknown, message?: string): void
  warn(payload: unknown, message?: string): void
  error(payload: unknown, message?: string): void
}

const silentLogger: WsLogger = { info: () => {}, warn: () => {}, error: () => {} }

export interface GameSocketHandlerDependencies {
  readonly registry: RoomSessionRegistry
  readonly broadcaster: RoomBroadcaster
  readonly snapshots: RealtimeRoomSnapshotService
  readonly heartbeat: HeartbeatMonitor
  readonly users: UserService
  readonly rooms: RoomService
  readonly closeScheduler: RoomCloseScheduler
  readonly games: GameModuleRegistry
  readonly logger?: WsLogger
}

const roomJoinPayloadSchema = z.object({
  roomId: z.string().nullish(),
  nickname: z.string().nullish(),
  sessionToken: z.string().nullish(),
})

const roomReadyPayloadSchema = z.object({ ready: z.boolean().nullish() })

const reactionSendPayloadSchema = z.object({ reaction: z.unknown() })

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

const isReaction = (value: unknown): value is ReactionType =>
  REACTION_TYPES.includes(value as ReactionType)

/**
 * WebSocket 게이트웨이.
 *
 * 소켓 수명(연결·메시지·종료)에서 하는 일은 인증·구독·브로드캐스트뿐이다.
 * **방 멤버십의 권위는 Redis**이고 REST가 그것을 바꾼다(DESIGN.md 원칙 3).
 */
export class GameSocketHandler {
  private readonly log: WsLogger

  /**
   * 방에 붙은 게임의 **모듈이 아직 없을 때** 쓰는 대역(게임 슬라이스 3.x가 하나씩
   * 채운다). 게임 상태가 없으므로 `hasState`는 false(=30초 유예)이고, 재접속
   * 스냅샷은 실시간 병합 방 스냅샷 그대로다(reconnect.md의 "PLAYING이 아니면"
   * 경우와 같다). 여기서 `require()`로 던지게 하면 모듈이
   * 없는 게임의 방은 대기실조차 돌지 않는다 — 세 게임의 모듈이 모두 등록될 때까지
   * 이 대역이 남는다.
   */
  private readonly moduleless: RoomGameHooks

  /** 텍스트 채팅 중계(docs/design/chat.md). 서버가 들고 있는 상태는 도배 한도 기록뿐이다. */
  private readonly chat: ChatChannel

  /** 컨트롤러 링크 시그널링 릴레이(docs/design/controller-signal.md). 상태가 없다. */
  private readonly controllerSignal: ControllerSignalChannel

  constructor(private readonly deps: GameSocketHandlerDependencies) {
    this.log = deps.logger ?? silentLogger
    this.chat = new ChatChannel({ broadcaster: deps.broadcaster })
    this.controllerSignal = new ControllerSignalChannel({
      registry: deps.registry,
      send: (socket, message) => this.send(socket, message),
    })
    this.moduleless = {
      pause: async () => {},
      resume: async () => {},
      close: async () => {},
      removePlayer: async () => {},
      hasState: async () => false,
      reconnect: async (roomId) => this.deps.snapshots.snapshot(roomId),
    }
  }

  /**
   * 연결 직후 `sys.connected`. **재연결마다 다시 보내야 한다** — 클라이언트는 이
   * 메시지를 받고서야 하트비트를 시작한다.
   */
  connected(socket: ClientSocket): void {
    this.send(
      socket,
      envelope('sys.connected', {
        serverTs: Date.now(),
        protocolVersion: WS_PROTOCOL_VERSION,
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      }),
    )
    this.deps.heartbeat.track(socket, () => this.disconnectIdle(socket))
  }

  /** 봉투 파싱 실패는 `INVALID_MESSAGE`(refMsgId 없음)이고 연결은 유지된다. */
  async message(socket: ClientSocket, raw: unknown): Promise<void> {
    const message = parseInbound(raw)
    if (!message) {
      this.log.warn({ raw: String(raw).slice(0, 200) }, '깨진 WS 메시지')
      this.sendError(socket, 'INVALID_MESSAGE', '메시지 형식이 올바르지 않습니다.')
      return
    }
    switch (message.type) {
      case 'sys.ping':
        return this.handleSysPing(socket)
      case 'room.join':
        return this.handleRoomJoin(socket, message)
      case 'room.leave':
        return this.handleRoomLeave(socket)
      case 'room.ready':
        return this.handleRoomReady(socket, message)
      case 'reaction.send':
        return this.handleReactionSend(socket, message)
      // 채팅은 방 레벨이라 게임 네임스페이스(game.<code>.*) 접두사가 없다.
      case 'chat.send':
        return this.handleChatSend(socket, message)
      case 'ctrl.signal':
        return this.handleControllerSignal(socket, message)
      default:
        return this.handleGameMessage(socket, message)
    }
  }

  /** 소켓 종료. phase에 따라 "오프라인 전이"와 "명단 이탈"로 갈린다. */
  async closed(socket: ClientSocket): Promise<void> {
    this.deps.heartbeat.untrack(socket)
    // 도배 한도 기록 정리가 아래 분기보다 **먼저**다 — 레지스트리에서 소켓을 지우면
    // 소켓만으로는 누구였는지 알 수 없다(docs/design/chat.md).
    this.forgetChat(socket)
    const member = this.deps.registry.of(socket)
    if (!member) {
      this.deps.broadcaster.unregister(socket)
      return
    }
    if (this.deps.registry.phaseOf(member.roomId) === 'playing') {
      this.deps.broadcaster.unregister(socket)
      const offline = this.deps.registry.markOffline(socket)
      // 이미 새 소켓으로 교체된 뒤 도착한 옛 close는 아무것도 바꾸지 않는다.
      if (offline) this.broadcastPresence(offline.roomId, offline.playerId, 'offline')
      return
    }
    await this.leaveRoom(socket)
  }

  /* ---------------------------------------------------------------- room.join */

  /**
   * `room.join` = 인증 + 구독. 처리 순서 자체가 계약이다
   * (docs/design/realtime.md 「인증·구독」).
   */
  private async handleRoomJoin(socket: ClientSocket, message: InboundEnvelope): Promise<void> {
    const parsed = roomJoinPayloadSchema.safeParse(message.payload)
    if (!parsed.success) {
      this.sendError(socket, 'INVALID_MESSAGE', 'room.join payload가 올바르지 않습니다.', message)
      return
    }
    const roomId = parsed.data.roomId ?? ''
    if (roomId.trim().length === 0) {
      this.sendError(socket, 'INVALID_MESSAGE', 'roomId가 필요합니다.', message)
      return
    }

    // 인메모리 유령 방 방지: Redis에 없는 방에는 아무도 등록하지 않는다.
    const room = await this.deps.rooms.getSnapshot(roomId)
    if (room.phase === null) {
      this.sendError(
        socket,
        'ROOM_NOT_FOUND',
        '방이 종료됐습니다. 홈에서 새로 시작해 주세요.',
        message,
      )
      return
    }
    this.deps.registry.registerGame(roomId, room.gameCode)
    this.deps.registry.markPhase(roomId, toWsPhase(room.phase))

    let identity: Identity
    try {
      identity = await this.resolveIdentity(parsed.data)
    } catch (error) {
      // 만료를 INVALID_MESSAGE로 뭉개면 클라이언트가 세션 종료로 다루지 않아
      // 대기실에서 안내 없이 멈춘다 — 두 실패는 반드시 구분된다.
      if (error instanceof SessionAuthenticationError) {
        this.sendError(
          socket,
          'SESSION_EXPIRED',
          '입장 정보가 만료됐습니다. 방에 다시 참가해 주세요.',
          message,
        )
        return
      }
      this.sendError(socket, 'INVALID_MESSAGE', '닉네임이 올바르지 않습니다.', message)
      return
    }

    const previous = this.deps.registry.find(roomId, identity.playerId)
    const playing = this.deps.registry.phaseOf(roomId) === 'playing'
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
      this.sendError(
        socket,
        'GAME_ALREADY_STARTED',
        '이미 시작된 게임에는 새로 참가할 수 없습니다.',
        message,
      )
      return
    }

    const self = this.deps.registry.join(roomId, socket, identity.playerId, identity.nickname)
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
    this.deps.broadcaster.register(roomId, socket)
    let snapshot: unknown
    try {
      snapshot = await this.game(roomId).reconnect(roomId, playerId)
    } catch (error) {
      this.log.error({ error, roomId, playerId }, '재접속 상태 스냅샷 생성 실패')
      this.deps.broadcaster.unregister(socket)
      this.sendError(
        socket,
        'INTERNAL',
        '게임 상태를 복원하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        message,
      )
      return
    }
    this.send(socket, envelope('sys.reconnected', { snapshot }, { roomId, msgId: message.msgId }))
    this.broadcastPresence(roomId, playerId, 'online')
    this.log.info({ playerId, roomId }, 'room.reconnected')
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
    const snapshot = await this.deps.snapshots.snapshot(roomId)
    this.send(
      socket,
      envelope(
        'room.joined',
        { you: identity.playerId, sessionToken: identity.sessionToken, snapshot },
        { roomId },
      ),
    )
    this.deps.broadcaster.broadcast(
      roomId,
      envelope('room.player_joined', { player: toWsPlayer(self) }, { roomId }),
    )
    this.deps.broadcaster.register(roomId, socket)
    // 취소할 예약이 있었다 = 방금 전까지 아무도 없었다 → 그때 끊어둔 마감 타이머를 다시 건다.
    if (this.deps.closeScheduler.cancel(roomId)) await this.game(roomId).resume(roomId)
    this.log.info({ playerId: identity.playerId, roomId, host: self.host }, 'room.join')
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
      const user = await this.deps.users.authenticateSession(token)
      return { playerId: user.userId, sessionToken: token, nickname: user.nickname }
    }
    const guest = await this.deps.users.createGuest(payload.nickname)
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
    this.deps.broadcaster.unregister(old)
    if (!isOpen(old)) return
    this.send(old, envelope('sys.disconnect', { reason: 'replaced_by_new_session' }))
    try {
      old.close(WS_CLOSE_POLICY_VIOLATION)
    } catch (error) {
      this.log.warn({ error }, '교체된 이전 소켓 정리 실패')
    }
  }

  /* -------------------------------------------------------- room.leave / ready */

  /**
   * `room.leave` = 방 퇴장(소켓은 유지). 게임 중에는 턴 순서·Redis 명단까지 함께
   * 정리해야 하므로 게임 모듈의 이탈 경로로 보낸다. 프론트 프로덕션 코드는 REST
   * `DELETE /rooms/{code}/players/me`를 쓰고 이 메시지를 보내지 않는다.
   */
  private async handleRoomLeave(socket: ClientSocket): Promise<void> {
    // 방을 떠나면 도배 한도 기록도 버린다. 아래 두 분기 모두 명단에서 이 소켓을 지우므로
    // 그 전에 처리해야 누구였는지 알 수 있다.
    this.forgetChat(socket)
    const member = this.deps.registry.of(socket)
    if (member && this.deps.registry.phaseOf(member.roomId) === 'playing') {
      this.deps.broadcaster.unregister(socket) // 본인을 팬아웃에서 뺀 뒤 player_left가 나간다
      await this.game(member.roomId).removePlayer(member.roomId, member.playerId)
      await this.deps.users.clearRoom(member.playerId)
      return
    }
    await this.leaveRoom(socket)
  }

  /**
   * `room.ready`는 **서버가 상태를 저장하지 않는다** — 본인 포함 방 전체에
   * 릴레이만 한다(서버 확인 이벤트로 각자 UI를 갱신).
   */
  private handleRoomReady(socket: ClientSocket, message: InboundEnvelope): void {
    const parsed = roomReadyPayloadSchema.safeParse(message.payload)
    if (!parsed.success) {
      this.sendError(socket, 'INVALID_MESSAGE', 'room.ready payload가 올바르지 않습니다.', message)
      return
    }
    const me = this.deps.registry.of(socket)
    if (!me) {
      this.sendError(socket, 'NOT_IN_ROOM', '방에 입장한 뒤에만 준비할 수 있습니다.', message)
      return
    }
    this.deps.broadcaster.broadcast(
      me.roomId,
      envelope(
        'room.ready_changed',
        { playerId: me.playerId, ready: parsed.data.ready ?? false },
        { roomId: me.roomId },
      ),
    )
  }

  /** `reaction.send` → `reaction.broadcast`. 본인도 받는다. 레이트 리밋은 없다. */
  private handleReactionSend(socket: ClientSocket, message: InboundEnvelope): void {
    const parsed = reactionSendPayloadSchema.safeParse(message.payload)
    if (!parsed.success) {
      this.sendError(
        socket,
        'INVALID_MESSAGE',
        'reaction.send payload가 올바르지 않습니다.',
        message,
      )
      return
    }
    const reaction = parsed.data.reaction
    if (reaction === null || reaction === undefined) {
      this.sendError(socket, 'INVALID_MESSAGE', 'reaction 종류가 필요합니다.', message)
      return
    }
    if (!isReaction(reaction)) {
      this.sendError(
        socket,
        'INVALID_MESSAGE',
        'reaction.send payload가 올바르지 않습니다.',
        message,
      )
      return
    }
    const me = this.deps.registry.of(socket)
    if (!me) {
      this.sendError(
        socket,
        'NOT_IN_ROOM',
        '방에 입장한 뒤에만 리액션을 보낼 수 있습니다.',
        message,
      )
      return
    }
    this.deps.broadcaster.broadcast(
      me.roomId,
      envelope('reaction.broadcast', { playerId: me.playerId, reaction }, { roomId: me.roomId }),
    )
  }

  /* -------------------------------------------------------------------- chat.* */

  /**
   * `chat.send` → 방 전원에게 `chat.message`. 거절 사유마다 코드가 갈린다: 빈 줄·길이
   * 초과는 `INVALID_MESSAGE`, 도배는 `RATE_LIMITED`다 — 사용자가 고칠 방법이 다르므로
   * (글을 바꾸는 것과 잠시 기다리는 것) 하나로 뭉개지 않는다.
   *
   * 검사 순서는 다른 방 레벨 메시지와 같다(payload 검증 → 멤버십) — 방 밖에서 깨진
   * payload를 보내면 `NOT_IN_ROOM`이 아니라 `INVALID_MESSAGE`가 나간다.
   */
  private handleChatSend(socket: ClientSocket, message: InboundEnvelope): void {
    const parsed = chatSendPayloadSchema.safeParse(message.payload)
    if (!parsed.success) {
      this.sendError(socket, 'INVALID_MESSAGE', 'chat.send payload가 올바르지 않습니다.', message)
      return
    }
    const me = this.deps.registry.of(socket)
    if (!me) {
      this.sendError(
        socket,
        'NOT_IN_ROOM',
        '방에 입장한 뒤에만 메시지를 보낼 수 있습니다.',
        message,
      )
      return
    }
    const rejection = this.chat.send(me, parsed.data.text)
    if (rejection === 'empty') {
      this.sendError(socket, 'INVALID_MESSAGE', '보낼 내용이 필요합니다.', message)
      return
    }
    if (rejection === 'too_long') {
      this.sendError(
        socket,
        'INVALID_MESSAGE',
        `메시지는 ${CHAT_TEXT_MAX_LENGTH}자까지 보낼 수 있습니다.`,
        message,
      )
      return
    }
    if (rejection === 'rate_limited') {
      this.sendError(
        socket,
        'RATE_LIMITED',
        '메시지를 너무 빠르게 보내고 있습니다. 잠시 후 다시 시도해 주세요.',
        message,
      )
    }
  }

  /** 이 소켓의 사람이 누구였는지 아는 동안 도배 한도 기록을 버린다. */
  private forgetChat(socket: ClientSocket): void {
    const member = this.deps.registry.of(socket)
    if (member) this.chat.forget(member.playerId)
  }

  /**
   * 게임 네임스페이스 메시지. 방에 없으면 `AUTH_REQUIRED`, 방의 게임이 처리하지
   * 못하는 타입이면 `INVALID_MESSAGE`다.
   *
   * 라우팅 판정은 전부 레지스트리의 `dispatch`에 있다 — 접두사(`game.<code>.`)
   * 검증·스트립·교차 네임스페이스 거부. 모듈이 없는 게임의 방도 여기서
   * `INVALID_MESSAGE`로 떨어진다.
   *
   * 모듈이 던지면 잡지 않는다 — 게이트웨이가 로그만 남기고 소켓을 살려 두는 것이
   * 핸들러 밖으로 나가는 예외와 같은 결과다.
   */
  private async handleGameMessage(socket: ClientSocket, message: InboundEnvelope): Promise<void> {
    const member = this.deps.registry.of(socket)
    if (!member) {
      this.sendError(
        socket,
        'AUTH_REQUIRED',
        '방에 입장한 뒤 게임 메시지를 보낼 수 있습니다.',
        message,
      )
      return
    }
    const gameCode = this.deps.registry.gameCodeOf(member.roomId)
    if (await this.deps.games.dispatch(gameCode, socket, message)) return
    this.log.warn(
      { roomId: member.roomId, gameCode, type: message.type },
      '지원하지 않는 게임 메시지',
    )
    this.sendError(
      socket,
      'INVALID_MESSAGE',
      '현재 방에서 지원하지 않는 게임 메시지입니다.',
      message,
    )
  }

  /* ------------------------------------------------------------- 이탈·방 폐쇄 */

  /** 명시 퇴장·대기실 소켓 종료: 명단 제거 → 팬아웃 제거 → 남은 사람에게 player_left. */
  private async leaveRoom(socket: ClientSocket): Promise<void> {
    const member = this.deps.registry.of(socket)
    // 방이 비면 레지스트리가 gameCode를 버리므로 제거 **전에** 모듈을 잡아 둔다.
    const game = member ? this.game(member.roomId) : null
    const gone = this.deps.registry.remove(socket)
    this.deps.broadcaster.unregister(socket) // 본인을 뺀 뒤 방송 → 본인은 안 받는다
    if (!gone || !game) return

    await this.deps.users.clearRoom(gone.playerId)
    this.deps.broadcaster.broadcast(
      gone.roomId,
      envelope('room.player_left', { playerId: gone.playerId }, { roomId: gone.roomId }),
    )
    if (this.deps.registry.snapshot(gone.roomId).players.length > 0) return

    // 마감 타이머는 즉시 끊는다 — 빈 방에서 자동 굴림·자동 기록이 계속 돌면 안 된다.
    await game.pause(gone.roomId)
    // 진행 상태는 아직 버리지 않는다. 새로고침은 "끊고 다시 연결"이라 여기서
    // 버리면 돌아온 사람이 자기 게임을 잃는다.
    const grace = (await game.hasState(gone.roomId)) ? ACTIVE_GAME_GRACE_MS : EMPTY_LOBBY_GRACE_MS
    this.deps.closeScheduler.schedule(gone.roomId, grace, () =>
      this.closeRoomIfStillEmpty(gone.roomId, game),
    )
  }

  /**
   * 유예가 끝났다. 예약 시점과 실행 시점 사이에 누군가 돌아올 수 있어 여기서 한 번
   * 더 확인한다 — 예약 취소와 이 검사는 의도적인 이중 방어다.
   */
  private async closeRoomIfStillEmpty(roomId: string, game: RoomGameHooks): Promise<void> {
    if (this.deps.registry.snapshot(roomId).players.length > 0) return
    await game.close(roomId)
    await this.deps.rooms.close(roomId)
    this.log.info({ roomId }, '빈 방을 닫았습니다')
  }

  /* -------------------------------------------------------------- 하트비트·전송 */

  private handleSysPing(socket: ClientSocket): void {
    // 갱신이 pong 전송보다 먼저다.
    this.deps.heartbeat.recordPing(socket)
    this.send(socket, envelope('sys.pong', { serverTs: Date.now() }))
  }

  private disconnectIdle(socket: ClientSocket): void {
    this.send(socket, envelope('sys.disconnect', { reason: 'idle_timeout' }))
    try {
      socket.close(WS_CLOSE_POLICY_VIOLATION)
    } catch (error) {
      this.log.warn({ error }, 'heartbeat timeout 세션 종료 실패')
    }
  }

  /**
   * `presence.update`는 **전이**만 알린다 — 최초 입장은 `player_joined`가
   * status를 나르므로 여기서 쏘지 않는다.
   */
  private broadcastPresence(roomId: string, playerId: string, status: PlayerStatus): void {
    this.deps.broadcaster.broadcast(
      roomId,
      envelope('presence.update', { playerId, status }, { roomId }),
    )
  }

  /** 방에 붙은 게임 모듈. 아직 이식되지 않은 게임이면 모듈 없는 방용 대역. */
  private game(roomId: string): RoomGameHooks {
    return this.deps.games.byCode(this.deps.registry.gameCodeOf(roomId)) ?? this.moduleless
  }

  /* -------------------------------------------------------------------- ctrl.* */

  /**
   * `ctrl.signal` → 지목된 상대에게만 릴레이. 검사 순서는 다른 방 레벨 메시지와 같다
   * (payload 검증 → 멤버십).
   *
   * **레이트 리밋을 붙인다면 이 타입은 예외로 잡아야 한다** — ICE 후보는 연결 수립
   * 순간에 몰려서, 채팅과 같은 기준을 걸면 링크가 안 붙는다.
   */
  private handleControllerSignal(socket: ClientSocket, message: InboundEnvelope): void {
    const parsed = controllerSignalPayloadSchema.safeParse(message.payload)
    if (!parsed.success) {
      this.sendError(socket, 'INVALID_MESSAGE', 'ctrl.signal payload가 올바르지 않습니다.', message)
      return
    }
    const to = parsed.data.to ?? ''
    if (to.trim().length === 0 || parsed.data.data === null || parsed.data.data === undefined) {
      this.sendError(socket, 'INVALID_MESSAGE', 'ctrl.signal은 to와 data가 필요합니다.', message)
      return
    }
    const me = this.deps.registry.of(socket)
    if (!me) {
      this.sendError(
        socket,
        'NOT_IN_ROOM',
        '방에 입장한 뒤에만 시그널을 보낼 수 있습니다.',
        message,
      )
      return
    }
    this.controllerSignal.signal(me, to, parsed.data.data)
  }

  private send(socket: ClientSocket, message: ReturnType<typeof envelope>): void {
    if (!isOpen(socket)) return
    try {
      socket.send(JSON.stringify(message))
    } catch (error) {
      this.log.warn({ error }, 'WS 전송 실패')
    }
  }

  /** `error` 봉투에는 roomId·msgId를 싣지 않는다 — 대신 payload의 refMsgId로 짝을 맞춘다. */
  private sendError(
    socket: ClientSocket,
    code: WsErrorCode,
    message: string,
    request?: InboundEnvelope,
  ): void {
    this.send(socket, envelope('error', { code, message, refMsgId: request?.msgId }))
  }
}
