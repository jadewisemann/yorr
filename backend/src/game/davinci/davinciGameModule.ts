import { z } from 'zod'
import { CodedError } from '../../errors.js'
import type { GameStartResult } from '../../room/roomService.js'
import type { InboundEnvelope } from '../../ws/envelope.js'
import type { WsErrorCode, WsRoomSnapshot } from '../../ws/protocol.js'
import type { ClientSocket } from '../../ws/socket.js'
import { DelegatingGameModule, sendModuleError } from '../delegatingGameModule.js'
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

export class DavinciGameModule
  extends DelegatingGameModule<DavinciGameService<WsRoomSnapshot, ClientSocket>>
  implements GameModule
{
  readonly code = DAVINCI_CODE

  constructor(
    games: DavinciGameService<WsRoomSnapshot, ClientSocket>,
    private readonly sessions: DavinciSessionLookup<ClientSocket>,
  ) {
    super(games)
  }

  async start(roomCode: string, game: GameStartResult): Promise<void> {
    await this.games.start(roomCode, game.snapshot)
  }

  /** 재접속 스냅샷은 **그 사람 시점**이다 — 남의 감춘 숫자는 실리지 않는다. */
  async reconnect(roomCode: string, playerId: string): Promise<WsRoomSnapshot> {
    return this.games.reconnect(roomCode, playerId)
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

  private sendError(
    socket: ClientSocket,
    code: WsErrorCode,
    message: string,
    request: InboundEnvelope,
  ): void {
    sendModuleError(socket, code, message, request)
  }
}
