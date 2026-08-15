import { z } from 'zod'
import { CodedError } from '../../errors.js'
import type { GameStartResult } from '../../room/roomService.js'
import { envelope, type InboundEnvelope } from '../../ws/envelope.js'
import type { WsErrorCode, WsRoomSnapshot } from '../../ws/protocol.js'
import { type ClientSocket, isOpen } from '../../ws/socket.js'
import type { GameModule } from '../module.js'
import { DUEL_CODE } from './duelCode.js'
import type { DuelGameService } from './duelGameService.js'
import type { DuelSessionLookup } from './duelPorts.js'

/**
 * 결투의 WS 표면.
 *
 * 인바운드는 **`draw` 하나뿐**이다(ready 메시지는 없다 — 게임 시작 즉시 결투가
 * 시작된다). 정원·시작 인원·봇 지원 여부는 `GAME_CATALOG`가 유일한 출처이므로 여기
 * 없다(`game/module.ts` 주석 참고).
 */
const drawPayloadSchema = z.object({
  inputSeq: z.number().int(),
  reactionMs: z.number().int(),
})

export class DuelGameModule implements GameModule {
  readonly code = DUEL_CODE

  constructor(
    private readonly games: DuelGameService<WsRoomSnapshot>,
    private readonly sessions: DuelSessionLookup<ClientSocket>,
  ) {}

  async start(roomCode: string, game: GameStartResult): Promise<void> {
    await this.games.start(roomCode, game.snapshot)
  }

  async reset(roomCode: string): Promise<void> {
    await this.games.reset(roomCode)
  }

  async reconnect(roomCode: string): Promise<WsRoomSnapshot> {
    return this.games.reconnect(roomCode)
  }

  async pause(roomCode: string): Promise<void> {
    await this.games.pause(roomCode)
  }

  async resume(roomCode: string): Promise<void> {
    await this.games.resume(roomCode)
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
    return eventType === 'draw'
  }

  /**
   * `game.duel.draw`. 소켓의 현재 방과 봉투의 roomId가 **일치해야** 한다 — 다른
   * 방의 결투에 총을 뽑을 수 없다.
   *
   * 오류 응답은 모듈이 직접 보낸다. 두 갈래뿐이다:
   * - 멤버십 불일치 → `NOT_IN_ROOM`
   * - payload 형식 위반·도메인 거부 → `INVALID_MESSAGE`. 도메인 오류는 **코드 문자열
   *   그대로**(`invalid_duel_draw`) 나가고, 그 밖의 실패(락 경합 등)는
   *   `invalid draw payload`로 뭉개진다(계약).
   */
  async handle(socket: ClientSocket, message: InboundEnvelope): Promise<void> {
    const member = this.sessions.of(socket)
    if (member === null || message.roomId === undefined || message.roomId !== member.roomId) {
      this.sendError(socket, 'NOT_IN_ROOM', 'current room membership is required', message)
      return
    }
    const payload = drawPayloadSchema.safeParse(message.payload)
    if (!payload.success) {
      this.sendError(socket, 'INVALID_MESSAGE', 'invalid draw payload', message)
      return
    }
    try {
      await this.games.draw(message.roomId, member.playerId, payload.data)
    } catch (error) {
      const reason = error instanceof CodedError ? error.code : 'invalid draw payload'
      this.sendError(socket, 'INVALID_MESSAGE', reason, message)
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
      // 죽은 소켓 하나가 결투를 멈추게 하지 않는다(게이트웨이의 close 경로가 정리한다).
    }
  }
}
