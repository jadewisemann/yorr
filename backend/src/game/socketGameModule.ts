import { CodedError } from '../errors.js'
import { envelope, type InboundEnvelope } from '../ws/envelope.js'
import type { WsErrorCode, WsRoomSnapshot } from '../ws/protocol.js'
import { type ClientSocket, isOpen } from '../ws/socket.js'
import type { GameModule } from './module.js'

/** 소켓 → 그 소켓이 앉아 있는 방·플레이어. `RoomSessionRegistry`가 만족한다. */
export interface SocketMembership {
  of(socket: ClientSocket): { readonly playerId: string; readonly roomId: string } | null
}

/**
 * 게임 서비스의 수명주기 표면. 세 게임 모듈이 이 훅들을 **그대로** 넘기기만 한다.
 * `start`와 `reconnect`는 게임마다 인자가 달라(탁구는 START 결과 전체를 쓰고, 다빈치의
 * 재접속 스냅샷은 보는 사람에 따라 다르다) 여기 없고 각 모듈이 직접 구현한다.
 */
export type GameLifecycle = Pick<
  GameModule,
  'reset' | 'pause' | 'resume' | 'rehydrate' | 'removePlayer' | 'close' | 'hasState'
>

/**
 * WS 표면을 가진 게임 모듈의 공통 뼈대.
 *
 * 세 게임(결투·다빈치·탁구)이 같은 것을 세 벌 갖고 있었다 — 수명주기 일곱 훅의 위임,
 * 멤버십 검사, 오류 봉투 전송이다. 게임마다 다른 것은 **어떤 이벤트를 듣고 무엇으로
 * 넘기는가**뿐이라 그 자리만 추상으로 남겼다.
 *
 * 오류 응답을 모듈이 직접 보내는 것이 계약이다(docs/design/game-modules.md) — 게이트웨이는
 * `handle`의 예외를 로그만 남기고 삼킨다.
 */
export abstract class SocketGameModule implements GameModule {
  abstract readonly code: string

  protected constructor(
    private readonly lifecycle: GameLifecycle,
    private readonly sessions: SocketMembership,
  ) {}

  abstract start(roomCode: string, game: never): Promise<void>
  abstract reconnect(roomCode: string, playerId: string): Promise<WsRoomSnapshot>
  abstract handles(eventType: string): boolean

  /**
   * 접두사가 벗겨진 이벤트를 게임 서비스로 넘긴다. 던지면 `INVALID_MESSAGE`가 되고,
   * 그 이유는 `reasonFor`가 정한다.
   */
  protected abstract dispatch(message: InboundEnvelope, playerId: string): Promise<void>

  async reset(roomCode: string): Promise<void> {
    await this.lifecycle.reset(roomCode)
  }

  async pause(roomCode: string): Promise<void> {
    await this.lifecycle.pause(roomCode)
  }

  async resume(roomCode: string): Promise<void> {
    await this.lifecycle.resume(roomCode)
  }

  async rehydrate(roomCode: string): Promise<void> {
    await this.lifecycle.rehydrate(roomCode)
  }

  async removePlayer(roomCode: string, playerId: string): Promise<void> {
    await this.lifecycle.removePlayer(roomCode, playerId)
  }

  async close(roomCode: string): Promise<void> {
    await this.lifecycle.close(roomCode)
  }

  async hasState(roomCode: string): Promise<boolean> {
    return this.lifecycle.hasState(roomCode)
  }

  /**
   * 소켓의 현재 방과 봉투의 roomId가 **일치해야** 한다 — 다른 방의 판에 손댈 수 없다.
   *
   * 갈래는 둘뿐이다: 멤버십 불일치는 `NOT_IN_ROOM`, payload 형식 위반과 도메인 거부는
   * `INVALID_MESSAGE`다.
   */
  async handle(socket: ClientSocket, message: InboundEnvelope): Promise<void> {
    const member = this.sessions.of(socket)
    if (member === null || message.roomId === undefined || message.roomId !== member.roomId) {
      this.sendError(socket, 'NOT_IN_ROOM', 'current room membership is required', message)
      return
    }
    try {
      await this.dispatch(message, member.playerId)
    } catch (error) {
      this.sendError(socket, 'INVALID_MESSAGE', this.reasonFor(error, message), message)
    }
  }

  /**
   * 실패를 무엇으로 답할지. 기본은 "도메인 오류는 코드 문자열 그대로, 나머지는 뭉갠다"이며
   * **어느 예외를 도메인 오류로 볼지는 게임마다 다르다** — 탁구는 락 경합
   * (`game_state_busy`)을 뭉개려고 `DomainError`만 통과시킨다.
   */
  protected reasonFor(error: unknown, message: InboundEnvelope): string {
    return error instanceof CodedError ? error.code : this.fallbackReason(message)
  }

  /** 도메인 오류가 아닌 실패를 뭉갤 문구. */
  protected fallbackReason(message: InboundEnvelope): string {
    return `invalid ${message.type} payload`
  }

  /** `error` 봉투에는 roomId·msgId를 싣지 않는다 — payload의 refMsgId로 짝을 맞춘다. */
  protected sendError(
    socket: ClientSocket,
    code: WsErrorCode,
    message: string,
    request: InboundEnvelope,
  ): void {
    if (!isOpen(socket)) return
    try {
      socket.send(JSON.stringify(envelope('error', { code, message, refMsgId: request.msgId })))
    } catch {
      // 죽은 소켓 하나가 판을 멈추게 하지 않는다(게이트웨이의 close 경로가 정리한다).
    }
  }
}
