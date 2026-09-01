import { z } from 'zod'
import { DomainError } from '../../errors.js'
import type { InboundEnvelope } from '../../ws/envelope.js'
import type { WsRoomSnapshot } from '../../ws/protocol.js'
import { PING_PONG } from '../catalog.js'
import { SocketGameModule, type SocketMembership } from '../socketGameModule.js'
import type { PingPongGameService, PingPongGameStart } from './pingPongGameService.js'
import type { PingPongState, PingPongSwingPayload } from './pingPongState.js'

/**
 * 탁구 게임 모듈.
 *
 * 하는 일은 라우팅과 오류 응답뿐이다: 멤버십·roomId 검증 → payload 파싱 →
 * 서비스 호출. 정원·봇 지원 여부는 여기 없다 — `game/catalog.ts`가 유일한
 * 출처다(PING_PONG은 2..2인·봇 없음).
 *
 * 게이트웨이는 `handle`의 예외를 로그만 남기고 삼키므로 **오류 응답은 모듈이
 * 직접 보내야 한다**(game-modules.md) — 그 배관과 수명주기 위임은
 * `SocketGameModule`에 있다.
 */

/**
 * 없는 필드는 0으로 관용한다(`{}` → `{inputSeq:0, clientTs:0}`) —
 * 판정은 서비스가 한다.
 */
const swingPayloadSchema = z
  .object({
    inputSeq: z.number().nullish(),
    clientTs: z.number().nullish(),
  })
  .nullish()

/**
 * 대시보드가 보고한 `PingPongState`. **서버가 랠리를 다시 계산하지 않으므로 이 값이
 * 그대로 Redis에 남고 방에 방송된다** — 그래서 모양은 여기서 끝까지 검증한다.
 * "누가 보냈나·되돌아가지 않나·roster를 바꾸지 않나"는 `hostReport`가 본다.
 */
const hostStateSchema = z.object({
  version: z.number().int().nonnegative(),
  phase: z.enum(['PREPARING', 'COUNTDOWN', 'PLAYING', 'FINISHED']),
  playerOrder: z.array(z.string()),
  scores: z.record(z.string(), z.number()),
  lastInputSeq: z.record(z.string(), z.number()),
  readyPlayerIds: z.array(z.string()),
  ball: z.object({
    pos: z.number(),
    direction: z.union([z.literal(1), z.literal(-1)]),
    speed: z.number(),
    smash: z.boolean(),
    fault: z.enum(['OUT', 'NET']).nullish(),
    faultFrom: z.number(),
    x0: z.number(),
    x1: z.number(),
    launchedAt: z.number(),
  }),
  rally: z.number(),
  serveReceiverId: z.string().nullish(),
  nextActionAt: z.number(),
  lastEvent: z
    .object({
      id: z.number(),
      type: z.enum([
        'READY',
        'PRACTICE',
        'PLAYER_READY',
        'SERVE',
        'TOO_EARLY',
        'TOO_LATE',
        'OK',
        'NICE',
        'SMASH',
        'OUT',
        'NET',
        'POINT',
        'GAME_OVER',
        'OPPONENT_LEFT',
      ]),
      playerId: z.string(),
      at: z.number(),
    })
    .nullish(),
})

export class PingPongGameModule extends SocketGameModule {
  readonly code = PING_PONG

  constructor(
    private readonly games: PingPongGameService<WsRoomSnapshot>,
    sessions: SocketMembership,
  ) {
    super(games, sessions)
  }

  async start(roomCode: string, game: PingPongGameStart): Promise<void> {
    await this.games.start(roomCode, game)
  }

  async reconnect(roomCode: string): Promise<WsRoomSnapshot> {
    return this.games.reconnect(roomCode)
  }

  /** 접두사가 벗겨진 이벤트명으로 판정한다. 탁구가 듣는 것은 이 둘뿐이다. */
  handles(eventType: string): boolean {
    return eventType === 'swing' || eventType === 'ready' || eventType === 'host_state'
  }

  protected async dispatch(message: InboundEnvelope, playerId: string): Promise<void> {
    const roomId = message.roomId as string
    if (message.type === 'ready') {
      await this.games.ready(roomId, playerId)
      return
    }
    if (message.type === 'host_state') {
      // 파티 모드에서 대시보드가 판정한 상태(frontend ADR-0003). 발신자·version·roster
      // 검증은 `hostReport`가 하므로 여기서는 모양만 본다.
      await this.games.hostState(roomId, playerId, parseHostState(message.payload))
      return
    }
    await this.games.swing(roomId, playerId, parseSwing(message.payload))
  }

  /**
   * 갈래가 계약이다: `DomainError`만 자기 코드를 싣고, 그 밖은 전부
   * `invalid swing payload`로 뭉개진다 — payload 파싱 실패는 물론 `game_state_busy`
   * (락 경합)도 여기로 온다. 그래서 기본 판정(`CodedError`)보다 좁다.
   */
  protected override reasonFor(error: unknown): string {
    return error instanceof DomainError ? error.code : 'invalid swing payload'
  }
}

/**
 * `null`·비객체 payload는 그대로 넘겨 서비스가 `invalid_ping_pong_swing`으로
 * 튕기게 한다.
 *
 * 모양이 어긋나면 던진다 — 호출부가 `INVALID_MESSAGE`로 바꾼다.
 */
const parseHostState = (payload: unknown): PingPongState => {
  const parsed = hostStateSchema.parse(payload)
  const { fault, ...ball } = parsed.ball
  const { serveReceiverId, lastEvent, ...rest } = parsed
  // null과 undefined를 갈라 둔다 — 상태 타입은 `?: T | undefined`라 null이 들어가면
  // 직렬화·재접속 스냅샷에서 없는 필드가 아니라 null 필드가 된다.
  return {
    ...rest,
    ball: { ...ball, ...(fault ? { fault } : {}) },
    ...(serveReceiverId ? { serveReceiverId } : {}),
    ...(lastEvent ? { lastEvent } : {}),
  }
}

const parseSwing = (payload: unknown): PingPongSwingPayload | null => {
  const parsed = swingPayloadSchema.parse(payload)
  if (!parsed) return null
  return { inputSeq: parsed.inputSeq ?? 0, clientTs: parsed.clientTs ?? 0 }
}
