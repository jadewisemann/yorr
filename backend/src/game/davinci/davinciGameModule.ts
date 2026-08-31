import { z } from 'zod'
import { CodedError } from '../../errors.js'
import type { GameStartResult } from '../../room/roomService.js'
import { envelope, type InboundEnvelope } from '../../ws/envelope.js'
import type { WsErrorCode, WsRoomSnapshot } from '../../ws/protocol.js'
import { type ClientSocket, isOpen } from '../../ws/socket.js'
import type { GameModule } from '../module.js'
import { DAVINCI_CODE } from './davinciCode.js'
import type { DavinciGameService } from './davinciGameService.js'
import type { DavinciSessionLookup } from './davinciPorts.js'

/**
 * 다빈치 코드의 WS 표면.
 *
 * 인바운드는 셋이다: `guess`(상대 타일 숫자 부르기) · `decide`(맞힌 뒤 계속/멈춤) ·
 * `place`(조커 자리 정하기). 정원·시작 인원·봇 지원 여부는 `GAME_CATALOG`가 유일한
 * 출처이므로 여기 없다(2.1의 결정 — `game/module.ts` 주석 참고).
 */
const guessPayloadSchema = z.object({
  inputSeq: z.number().int(),
  targetId: z.string().min(1),
  tileId: z.string().min(1),
  number: z.number().int(),
})

const decidePayloadSchema = z.object({
  inputSeq: z.number().int(),
  decision: z.union([z.literal('CONTINUE'), z.literal('STOP')]),
})

const placePayloadSchema = z.object({
  inputSeq: z.number().int(),
  index: z.number().int(),
})

const HANDLED = new Set(['guess', 'decide', 'place'])

export class DavinciGameModule implements GameModule {
  readonly code = DAVINCI_CODE

  constructor(
    private readonly games: DavinciGameService<WsRoomSnapshot, ClientSocket>,
    private readonly sessions: DavinciSessionLookup<ClientSocket>,
  ) {}

  async start(roomCode: string, game: GameStartResult): Promise<void> {
    await this.games.start(roomCode, game.snapshot)
  }

  async reset(roomCode: string): Promise<void> {
    await this.games.reset(roomCode)
  }

  /** 재접속 스냅샷은 **그 사람 시점**이다 — 남의 감춘 숫자는 실리지 않는다. */
  async reconnect(roomCode: string, playerId: string): Promise<WsRoomSnapshot> {
    return this.games.reconnect(roomCode, playerId)
  }

  async pause(roomCode: string): Promise<void> {
    await this.games.pause(roomCode)
  }

  async resume(roomCode: string): Promise<void> {
    await this.games.resume(roomCode)
  }

  async rehydrate(roomCode: string): Promise<void> {
    await this.games.rehydrate(roomCode)
  }

  async removePlayer(roomCode: string, playerId: string): Promise<void> {
    await this.games.removePlayer(roomCode, playerId)
  }

  async close(roomCode: string): Promise<void> {
    await this.games.close(roomCode)
  }

  async hasState(roomCode: string): Promise<boolean> {
    return this.games.hasState(roomCode)
  }

  handles(eventType: string): boolean {
    return HANDLED.has(eventType)
  }

  /**
   * 소켓의 현재 방과 봉투의 roomId가 **일치해야** 한다 — 다른 방의 판에 손댈 수 없다.
   *
   * 오류 응답은 모듈이 직접 보낸다(2.1의 계약). 갈래는 결투와 같은 둘이다:
   * 멤버십 불일치는 `NOT_IN_ROOM`, payload 형식 위반·도메인 거부는 `INVALID_MESSAGE`다.
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
      const reason = error instanceof CodedError ? error.code : `invalid ${message.type} payload`
      this.sendError(socket, 'INVALID_MESSAGE', reason, message)
    }
  }

  private async dispatch(message: InboundEnvelope, playerId: string): Promise<void> {
    const roomId = message.roomId as string
    switch (message.type) {
      case 'guess':
        return this.games.guess(roomId, playerId, guessPayloadSchema.parse(message.payload))
      case 'decide':
        return this.games.decide(roomId, playerId, decidePayloadSchema.parse(message.payload))
      case 'place':
        return this.games.place(roomId, playerId, placePayloadSchema.parse(message.payload))
      default:
        throw new CodedError('invalid_davinci_event')
    }
  }

  /** `error` 봉투에는 roomId·msgId를 싣지 않는다 — payload의 refMsgId로 짝을 맞춘다. */
  private sendError(
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
