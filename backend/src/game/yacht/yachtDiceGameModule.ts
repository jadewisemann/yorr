import { DomainError } from '../../errors.js'
import type { GameStartResult } from '../../room/roomService.js'
import type { InboundEnvelope } from '../../ws/envelope.js'
import type { WsRoomSnapshot } from '../../ws/protocol.js'
import type { ClientSocket } from '../../ws/socket.js'
import { YACHT_DICE } from '../catalog.js'
import type { GameModule } from '../module.js'
import {
  handleHold,
  handleRoll,
  handleShake,
  handleSubmit,
  handleThrow,
  type InboundDeps,
} from './yachtInbound.js'
import { YachtLifecycle, type YachtLifecycleDeps } from './yachtLifecycle.js'
import type { YachtSeatRegistry } from './yachtPorts.js'
import type { YachtTurnActionService } from './yachtTurnActionService.js'
import { WsErrorSender } from './yachtWsErrors.js'
import { isYachtInboundEvent } from './yachtWsTypes.js'

export interface YachtDiceGameModuleDeps extends YachtLifecycleDeps {
  readonly actions: YachtTurnActionService
  readonly seats: YachtSeatRegistry
}

export interface YachtDiceGameModuleOptions {
  readonly now?: () => number
}

interface Seat {
  readonly playerId: string
  readonly roomId: string
}

/**
 * 야추 게임 모듈.
 *
 * 이 클래스가 하는 일은 두 가지다: ① **수명주기 훅**을 라운드 프레임워크에 넘기고,
 * ② **인바운드 5메시지**를 검증·라우팅한다.
 *
 * 수명주기 순서는 `yachtLifecycle.ts`, 오류 코드 매핑은 `yachtWsErrors.ts`가
 * 정본이다. 상태 전이·점수·타이머는 하나도 여기 없다(프레임워크가 갖고 있다).
 */
export class YachtDiceGameModule implements GameModule {
  readonly code = YACHT_DICE

  private readonly seats: YachtSeatRegistry
  private readonly now: () => number
  private readonly inbound: InboundDeps
  private readonly lifecycle: YachtLifecycle
  private readonly errors: WsErrorSender

  constructor(deps: YachtDiceGameModuleDeps, options: YachtDiceGameModuleOptions = {}) {
    this.seats = deps.seats
    this.now = options.now ?? Date.now
    this.errors = new WsErrorSender({ now: this.now })
    this.lifecycle = new YachtLifecycle(deps, this.now)
    this.inbound = {
      actions: deps.actions,
      broadcaster: deps.broadcaster,
      now: this.now,
      rounds: deps.rounds,
      seatOf: (socket, message) => this.seatOf(socket, message),
      sendError: (socket, code, text, request) => this.errors.send(socket, code, text, request),
      sendDomainError: (socket, message, error) =>
        this.errors.sendDomainError(socket, message, error),
    }
  }

  /* ------------------------------------------------------------- 수명주기 훅 */

  async start(roomCode: string, game: GameStartResult): Promise<void> {
    await this.lifecycle.start(roomCode, game)
  }

  async reset(roomCode: string): Promise<void> {
    await this.lifecycle.reset(roomCode)
  }

  async reconnect(roomCode: string, playerId: string): Promise<WsRoomSnapshot> {
    return this.lifecycle.reconnect(roomCode, playerId)
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

  /* --------------------------------------------------------------- 메시지 라우팅 */

  handles(eventType: string): boolean {
    return isYachtInboundEvent(eventType)
  }

  async handle(socket: ClientSocket, message: InboundEnvelope): Promise<void> {
    switch (message.type) {
      case 'dice.roll':
        return handleRoll(this.inbound, socket, message)
      case 'dice.hold':
        return handleHold(this.inbound, socket, message)
      case 'dice.shake':
        return handleShake(this.inbound, socket, message)
      case 'dice.throw':
        return handleThrow(this.inbound, socket, message)
      case 'round.submit':
        return handleSubmit(this.inbound, socket, message)
      default:
        // `handles`가 걸러 주므로 dispatch 경로로는 도달할 수 없다.
        throw new DomainError('unsupported_game_message')
    }
  }

  /**
   * 봉투의 `roomId`가 **이 소켓의 방과 같은지** 확인한다. 다르면 `NOT_IN_ROOM` —
   * 다른 방의 게임을 조작하는 경로를 막는 유일한 검사다.
   */
  private seatOf(socket: ClientSocket, message: InboundEnvelope): Seat | null {
    const member = this.seats.of(socket)
    const roomId = message.roomId ?? ''
    if (roomId.trim().length === 0 || member === null || roomId !== member.roomId) {
      this.errors.send(socket, 'NOT_IN_ROOM', '현재 참가 중인 방에서만 보낼 수 있습니다.', message)
      return null
    }
    return { playerId: member.playerId, roomId: member.roomId }
  }
}
