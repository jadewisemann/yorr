import { z } from 'zod'
import { CodedError } from '../../errors.js'
import type { GameStartResult } from '../../room/roomService.js'
import type { InboundEnvelope } from '../../ws/envelope.js'
import type { WsRoomSnapshot } from '../../ws/protocol.js'
import type { ClientSocket } from '../../ws/socket.js'
import { SocketGameModule } from '../socketGameModule.js'
import { DAVINCI_CODE } from './davinciCode.js'
import type { DavinciGameService } from './davinciGameService.js'
import type { DavinciSessionLookup } from './davinciPorts.js'

/**
 * 다빈치 코드의 WS 표면.
 *
 * 인바운드는 셋이다: `guess`(상대 타일 숫자 부르기) · `decide`(맞힌 뒤 계속/멈춤) ·
 * `place`(조커 자리 정하기). 정원·시작 인원·봇 지원 여부는 `GAME_CATALOG`가 유일한
 * 출처이므로 여기 없다(2.1의 결정 — `game/module.ts` 주석 참고).
 *
 * 수명주기 위임·멤버십 검사·오류 봉투는 `SocketGameModule`이 갖고 있다.
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

export class DavinciGameModule extends SocketGameModule {
  readonly code = DAVINCI_CODE

  constructor(
    private readonly games: DavinciGameService<WsRoomSnapshot, ClientSocket>,
    sessions: DavinciSessionLookup<ClientSocket>,
  ) {
    super(games, sessions)
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

  protected async dispatch(message: InboundEnvelope, playerId: string): Promise<void> {
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
}
