import { z } from 'zod'
import type { GameModuleRegistry, RoomGameHooks } from '../game/module.js'
import type { RoomCloseScheduler } from '../room/closeScheduler.js'
import type { RoomService } from '../room/roomService.js'
import type { UserService } from '../user/session.js'
import type { RoomBroadcaster } from './broadcaster.js'
import { ChatChannel, chatSendPayloadSchema } from './chat.js'
import { ControllerSignalChannel, controllerSignalPayloadSchema } from './controllerSignal.js'
import { envelope, type InboundEnvelope, parseInbound } from './envelope.js'
import type { HeartbeatMonitor } from './heartbeat.js'
import { RoomJoinFlow } from './joinFlow.js'
import {
  CHAT_TEXT_MAX_LENGTH,
  HEARTBEAT_INTERVAL_MS,
  type PlayerStatus,
  REACTION_TYPES,
  type ReactionType,
  WS_CLOSE_POLICY_VIOLATION,
  WS_PROTOCOL_VERSION,
  type WsErrorCode,
} from './protocol.js'
import type { RoomSessionRegistry } from './registry.js'
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

const roomReadyPayloadSchema = z.object({ ready: z.boolean().nullish() })

const reactionSendPayloadSchema = z.object({ reaction: z.unknown() })

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

  /** `room.join`의 인증·구독 흐름. 갈래가 셋이라 따로 산다(joinFlow.ts). */
  private readonly joinFlow: RoomJoinFlow

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
    this.joinFlow = new RoomJoinFlow({
      deps,
      log: this.log,
      send: (socket, message) => this.send(socket, message),
      sendError: (socket, code, message, request) => this.sendError(socket, code, message, request),
      game: (roomId) => this.game(roomId),
      broadcastPresence: (roomId, playerId, status) =>
        this.broadcastPresence(roomId, playerId, status),
    })
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
        return this.joinFlow.handle(socket, message)
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
