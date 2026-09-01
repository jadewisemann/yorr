import { z } from 'zod'
import type { GameStartResult } from '../../room/roomService.js'
import type { InboundEnvelope } from '../../ws/envelope.js'
import type { WsRoomSnapshot } from '../../ws/protocol.js'
import type { ClientSocket } from '../../ws/socket.js'
import { SocketGameModule } from '../socketGameModule.js'
import { DUEL_CODE } from './duelCode.js'
import type { DuelGameService } from './duelGameService.js'
import type { DuelSessionLookup } from './duelPorts.js'

/**
 * 결투의 WS 표면.
 *
 * 인바운드는 **`draw` 하나뿐**이다(ready 메시지는 없다 — 게임 시작 즉시 결투가
 * 시작된다). 정원·시작 인원·봇 지원 여부는 `GAME_CATALOG`가 유일한 출처이므로 여기
 * 없다(2.1의 결정 — `game/module.ts` 주석 참고).
 *
 * 수명주기 위임·멤버십 검사·오류 봉투는 `SocketGameModule`이 갖고 있다. 도메인 오류는
 * **코드 문자열 그대로**(`invalid_duel_draw`) 나가고, 그 밖의 실패(락 경합 등)는
 * `invalid draw payload`로 뭉개진다.
 */
const drawPayloadSchema = z.object({
  inputSeq: z.number().int(),
  reactionMs: z.number().int(),
})

export class DuelGameModule extends SocketGameModule {
  readonly code = DUEL_CODE

  constructor(
    private readonly games: DuelGameService<WsRoomSnapshot>,
    sessions: DuelSessionLookup<ClientSocket>,
  ) {
    super(games, sessions)
  }

  async start(roomCode: string, game: GameStartResult): Promise<void> {
    await this.games.start(roomCode, game.snapshot)
  }

  async reconnect(roomCode: string): Promise<WsRoomSnapshot> {
    return this.games.reconnect(roomCode)
  }

  handles(eventType: string): boolean {
    return eventType === 'draw'
  }

  protected async dispatch(message: InboundEnvelope, playerId: string): Promise<void> {
    await this.games.draw(
      message.roomId as string,
      playerId,
      drawPayloadSchema.parse(message.payload),
    )
  }

  /** 이벤트가 하나뿐이라 문구도 하나다 — 이벤트명으로 조립하지 않는다. */
  protected override fallbackReason(): string {
    return 'invalid draw payload'
  }
}
