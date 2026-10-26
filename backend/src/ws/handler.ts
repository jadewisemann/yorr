import type { GameModuleRegistry, RoomGameHooks } from '../game/module.js'
import type { RoomCloseScheduler } from '../room/closeScheduler.js'
import type { RoomService } from '../room/roomService.js'
import type { UserService } from '../user/session.js'
import type { RoomBroadcaster } from './broadcaster.js'
import { ChatChannel } from './chat.js'
import { ControllerSignalChannel, controllerSignalPayloadSchema } from './controllerSignal.js'
import { envelope, type InboundEnvelope, parseInbound } from './envelope.js'
import type { HeartbeatMonitor } from './heartbeat.js'
import { silentLogger, type WsLogger } from './logger.js'
import {
  HEARTBEAT_INTERVAL_MS,
  type PlayerStatus,
  WS_CLOSE_POLICY_VIOLATION,
  WS_PROTOCOL_VERSION,
  type WsErrorCode,
} from './protocol.js'
import type { RoomSessionRegistry } from './registry.js'
import { handleRoomJoin, type JoinDeps } from './roomJoin.js'
import { RoomLifecycle } from './roomLifecycle.js'
import {
  handleChatSend,
  handleReactionSend,
  handleRoomReady,
  type RoomMessageDeps,
} from './roomMessages.js'
import type { RealtimeRoomSnapshotService } from './snapshot.js'
import { type ClientSocket, isOpen } from './socket.js'

export type { WsLogger } from './logger.js'
// 빈 방 유예 상수와 로거 타입은 roomLifecycle.ts·logger.ts가 정본이지만 기존
// 소비자(배선·테스트)가 이 파일에서 가져가므로 여기서 re-export한다.
export { ACTIVE_GAME_GRACE_MS, EMPTY_LOBBY_GRACE_MS } from './roomLifecycle.js'

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

  /** 방 레벨 메시지(ready·reaction·chat) — 게임과 무관한 셋을 한 자리에 모아 둔다. */
  private readonly roomMessages: RoomMessageDeps

  /** `room.join` — 인증·재접속 판정·이전 소켓 교체. */
  private readonly join: JoinDeps

  /** 소켓 종료·명시 퇴장·빈 방 폐쇄. */
  private readonly lifecycle: RoomLifecycle

  constructor(private readonly deps: GameSocketHandlerDependencies) {
    this.log = deps.logger ?? silentLogger
    this.chat = new ChatChannel({ broadcaster: deps.broadcaster })
    this.controllerSignal = new ControllerSignalChannel({
      registry: deps.registry,
      send: (socket, message) => this.send(socket, message),
    })
    this.roomMessages = {
      broadcaster: deps.broadcaster,
      chat: this.chat,
      registry: deps.registry,
      sendError: (socket, code, text, ref) => this.sendError(socket, code, text, ref),
    }
    this.join = {
      broadcaster: deps.broadcaster,
      closeScheduler: deps.closeScheduler,
      games: deps.games,
      log: this.log,
      registry: deps.registry,
      rooms: deps.rooms,
      snapshots: deps.snapshots,
      users: deps.users,
      send: (socket, message) => this.send(socket, message),
      sendError: (socket, code, text, ref) => this.sendError(socket, code, text, ref),
      game: (roomId) => this.game(roomId),
      broadcastPresence: (roomId, playerId, status) =>
        this.broadcastPresence(roomId, playerId, status),
    }
    this.lifecycle = new RoomLifecycle({
      registry: deps.registry,
      broadcaster: deps.broadcaster,
      users: deps.users,
      rooms: deps.rooms,
      closeScheduler: deps.closeScheduler,
      chat: this.chat,
      game: (roomId) => this.game(roomId),
      log: this.log,
      broadcastPresence: (roomId, playerId, status) =>
        this.broadcastPresence(roomId, playerId, status),
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
        return handleRoomJoin(this.join, socket, message)
      case 'room.leave':
        return this.handleRoomLeave(socket)
      case 'room.ready':
        return handleRoomReady(this.roomMessages, socket, message)
      case 'reaction.send':
        return handleReactionSend(this.roomMessages, socket, message)
      // 채팅은 방 레벨이라 게임 네임스페이스(game.<code>.*) 접두사가 없다.
      case 'chat.send':
        return handleChatSend(this.roomMessages, socket, message)
      case 'ctrl.signal':
        return this.handleControllerSignal(socket, message)
      default:
        return this.handleGameMessage(socket, message)
    }
  }

  /** 소켓 종료 — 명단 정리 순서는 `RoomLifecycle.closed`가 정본이다. */
  async closed(socket: ClientSocket): Promise<void> {
    this.deps.heartbeat.untrack(socket)
    await this.lifecycle.closed(socket)
  }

  /* ---------------------------------------------------------------- room.join */

  /**
   * `room.join` = 인증 + 구독. 처리 순서 자체가 계약이다
   * (docs/design/realtime.md 「인증·구독」).
   */
  /* -------------------------------------------------------- room.leave / ready */

  /** `room.leave` = 방 퇴장(소켓은 유지). 게임 중 정리는 게임 모듈의 이탈 경로가 맡는다. */
  private async handleRoomLeave(socket: ClientSocket): Promise<void> {
    await this.lifecycle.leave(socket)
  }

  /**
   * 게임 네임스페이스 메시지. 방에 없으면 `AUTH_REQUIRED`, 방의 게임이 처리하지
   * 못하는 타입이면 `INVALID_MESSAGE`다.
   *
   * 라우팅 판정은 전부 레지스트리 게임 레지스트리의 `dispatch`에 있다 — 접두사
   * (`game.<code>.`) 검증·스트립·교차 네임스페이스 거부. 모듈이 없는 게임의 방도
   * 여기서 `INVALID_MESSAGE`로 떨어진다.
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
