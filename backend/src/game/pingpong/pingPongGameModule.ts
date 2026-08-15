import { z } from 'zod'
import { DomainError } from '../../errors.js'
import type { InboundEnvelope } from '../../ws/envelope.js'
import type { WsErrorCode, WsRoomSnapshot } from '../../ws/protocol.js'
import type { ClientSocket } from '../../ws/socket.js'
import { isOpen } from '../../ws/socket.js'
import { PING_PONG } from '../catalog.js'
import type { GameModule } from '../module.js'
import type { PingPongGameService, PingPongGameStart } from './pingPongGameService.js'
import type { PingPongSwingPayload } from './pingPongState.js'

/**
 * 탁구 게임 모듈.
 *
 * 하는 일은 라우팅과 오류 응답뿐이다: 멤버십·roomId 검증 → payload 파싱 →
 * 서비스 호출. 정원·봇 지원 여부는 여기 없다 — `game/catalog.ts`가 유일한
 * 출처다(PING_PONG은 2..2인·봇 없음).
 *
 * 게이트웨이는 `handle`의 예외를 로그만 남기고 삼키므로 **오류 응답은 모듈이
 * 직접 보내야 한다**(game-modules.md).
 */

/** 소켓 → 그 소켓이 앉아 있는 방·플레이어. `RoomSessionRegistry`가 만족한다. */
export interface PingPongSocketMembership {
  of(socket: ClientSocket): { readonly playerId: string; readonly roomId: string } | null
}

/**
 * Jackson의 record 바인딩 자리. 없는 필드는 `long` 기본값 0이 되므로
 * (`{}` → `{inputSeq:0, clientTs:0}`) 여기서도 관용한다 — 판정은 서비스가 한다.
 */
const swingPayloadSchema = z
  .object({
    inputSeq: z.number().nullish(),
    clientTs: z.number().nullish(),
  })
  .nullish()

export class PingPongGameModule implements GameModule {
  readonly code = PING_PONG

  constructor(
    private readonly games: PingPongGameService<WsRoomSnapshot>,
    private readonly sessions: PingPongSocketMembership,
  ) {}

  async start(roomCode: string, game: PingPongGameStart): Promise<void> {
    await this.games.start(roomCode, game)
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

  /** 접두사가 벗겨진 이벤트명으로 판정한다. 탁구가 듣는 것은 이 둘뿐이다. */
  handles(eventType: string): boolean {
    return eventType === 'swing' || eventType === 'ready'
  }

  async handle(socket: ClientSocket, message: InboundEnvelope): Promise<void> {
    const member = this.sessions.of(socket)
    // 봉투의 roomId와 실제 좌석이 어긋나면 남의 방 게임을 움직일 수 있다.
    if (!member || !message.roomId || message.roomId !== member.roomId) {
      this.sendError(socket, 'NOT_IN_ROOM', 'current room membership is required', message)
      return
    }
    try {
      if (message.type === 'ready') {
        await this.games.ready(message.roomId, member.playerId)
        return
      }
      await this.games.swing(message.roomId, member.playerId, parseSwing(message.payload))
    } catch (error) {
      // 오류 갈래가 계약이다: `DomainError`만 자기 코드를 싣고, 그 밖은 전부
      // `invalid swing payload`로 뭉개진다 — payload 파싱 실패는 물론
      // `game_state_busy`(락 경합) 같은 상태 오류도 여기로 온다.
      // 예외를 다시 던지지 않는다(응답을 보냈으면 소켓은 살아 있다).
      const reason = error instanceof DomainError ? error.code : 'invalid swing payload'
      this.sendError(socket, 'INVALID_MESSAGE', reason, message)
    }
  }

  /** `error` 봉투는 roomId·msgId를 싣지 않는다 — payload의 refMsgId로 짝을 맞춘다. */
  private sendError(
    socket: ClientSocket,
    code: WsErrorCode,
    message: string,
    request: InboundEnvelope,
  ): void {
    if (!isOpen(socket)) return
    const frame = JSON.stringify({
      type: 'error',
      ts: Date.now(),
      payload: { code, message, refMsgId: request.msgId },
    })
    try {
      socket.send(frame)
    } catch {
      // 죽은 소켓에 보내다 실패하는 것은 이 경로의 관심사가 아니다.
    }
  }
}

/**
 * `null`·비객체 payload는 서비스가 `invalid_ping_pong_swing`으로 튕기는 것이
 * 계약이다 — 여기서 거르지 않고 null을 그대로 넘긴다.
 */
const parseSwing = (payload: unknown): PingPongSwingPayload | null => {
  const parsed = swingPayloadSchema.parse(payload)
  if (!parsed) return null
  return { inputSeq: parsed.inputSeq ?? 0, clientTs: parsed.clientTs ?? 0 }
}
