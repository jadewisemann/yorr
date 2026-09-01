import { DomainError } from '../../errors.js'
import type { GameStartResult } from '../../room/roomService.js'
import type { InboundEnvelope } from '../../ws/envelope.js'
import type { WsErrorCode, WsRoomSnapshot } from '../../ws/protocol.js'
import { type ClientSocket, isOpen } from '../../ws/socket.js'
import { YACHT_DICE } from '../catalog.js'
import type { GameModule } from '../module.js'
import { RoundSynchronizationError, type RoundSyncReason } from '../round/index.js'
import {
  ScoreConfirmationError,
  type ScoreConfirmationReason,
  ScoreDomainError,
} from '../score/index.js'
import {
  diceHoldPayloadSchema,
  diceRollPayloadSchema,
  diceShakePayloadSchema,
  diceThrowPayloadSchema,
  roundSubmitPayloadSchema,
  toDiceHoldPayload,
  toDiceRollPayload,
  toDiceShakeRequest,
  toDiceThrowRequest,
  toRoundSubmitPayload,
} from './payloads.js'
import type {
  YachtBroadcaster,
  YachtRealtimeSnapshots,
  YachtReconnectSnapshots,
  YachtRoundService,
  YachtRoundTimer,
  YachtSeatRegistry,
} from './yachtPorts.js'
import type { YachtTurnActionService } from './yachtTurnActionService.js'
import { isYachtInboundEvent, yachtWsType } from './yachtWsTypes.js'

export interface YachtDiceGameModuleDeps {
  readonly rounds: YachtRoundService
  readonly timers: YachtRoundTimer
  readonly actions: YachtTurnActionService
  readonly seats: YachtSeatRegistry
  readonly realtimeSnapshots: YachtRealtimeSnapshots<WsRoomSnapshot>
  readonly reconnectSnapshots: YachtReconnectSnapshots<WsRoomSnapshot>
  readonly broadcaster: YachtBroadcaster
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
 * 이 클래스가 하는 일은 두 가지다: ① **수명주기 훅**(start/reset/pause/resume/
 * removePlayer/close/hasState/reconnect)을 라운드 프레임워크 호출로 옮기고,
 * ② **인바운드 5메시지**를 검증·라우팅하고 도메인 이유 코드를 WS 오류 코드로 옮긴다.
 *
 * 상태 전이·점수·타이머는 하나도 여기 없다(프레임워크가 갖고 있다). 이 모듈은
 * Phase 2가 만든 프레임워크를 **처음으로 실제 구동시키는 수직 슬라이스**다.
 */
export class YachtDiceGameModule implements GameModule {
  readonly code = YACHT_DICE

  private readonly rounds: YachtRoundService
  private readonly timers: YachtRoundTimer
  private readonly actions: YachtTurnActionService
  private readonly seats: YachtSeatRegistry
  private readonly realtimeSnapshots: YachtRealtimeSnapshots<WsRoomSnapshot>
  private readonly reconnectSnapshots: YachtReconnectSnapshots<WsRoomSnapshot>
  private readonly broadcaster: YachtBroadcaster
  private readonly now: () => number

  constructor(deps: YachtDiceGameModuleDeps, options: YachtDiceGameModuleOptions = {}) {
    this.rounds = deps.rounds
    this.timers = deps.timers
    this.actions = deps.actions
    this.seats = deps.seats
    this.realtimeSnapshots = deps.realtimeSnapshots
    this.reconnectSnapshots = deps.reconnectSnapshots
    this.broadcaster = deps.broadcaster
    this.now = options.now ?? Date.now
  }

  /* ------------------------------------------------------------- 수명주기 훅 */

  /**
   * 방 phase 전이 **후** 첫 턴 준비. 순서가 계약이다:
   * 잔여 상태 제거(방어) → initialize(라운드 1, **host 우선 정렬**) →
   * 레지스트리 phase PLAYING → `state.sync` → 첫 턴 타이머.
   *
   * ⚠️ **`markPhase('playing')`이 이 자리에 있는 것이 중요하다.** 1.5·2.1이 이 구멍을
   * 열어 둔 채로 남겼다 — 레지스트리 phase를 옮기는 코드가 모듈 안에 있다.
   * 없으면 REST로 시작한 게임에 이미 붙어 있는 소켓의 phase가 `waiting`에 머물러
   * ① 끊긴 플레이어가 offline이 아니라 `room.player_left`가 되고
   * ② 재접속의 PLAYING 분기(스냅샷에 `game` 동봉)가 실전에서 도달하지 않는다.
   *
   * 실패하면 스스로 `reset`한 뒤 재throw한다 — `GameLifecycleService`가 그 예외를
   * 받아 ROLLBACK_START Lua로 방 phase까지 되돌린다.
   */
  async start(roomCode: string, game: GameStartResult): Promise<void> {
    // 이전 판의 잔여 상태가 남아 있으면 initialize가 SETNX에 걸려 시작 자체가 막힌다.
    await this.rounds.remove(roomCode)
    try {
      const firstTurn = await this.rounds.initialize(roomCode, 1, turnOrderOf(game))
      this.seats.markPhase(roomCode, 'playing')
      await this.broadcastState(roomCode)
      await this.timers.start(roomCode, firstTurn)
    } catch (error) {
      // reset이 또 던지면 그 예외가 원인을 대신 올라간다(롤백과 같은 판단).
      await this.reset(roomCode)
      throw error
    }
  }

  /** 로비 복귀 정리. 타이머 → 상태 → phase → 방송 순서가 계약이다. */
  async reset(roomCode: string): Promise<void> {
    await this.timers.cancelRoom(roomCode)
    await this.rounds.remove(roomCode)
    this.seats.markPhase(roomCode, 'waiting')
    await this.broadcastState(roomCode)
  }

  /**
   * 재접속 스냅샷.
   *
   * ⚠️ **순서가 계약이다**: `snapshot()` → `clearOfflineMisses()`. 2.8이
   * `GameReconnectSnapshotService`에 명시해 둔 규약이며, 스냅샷 조립이 실패하면
   * 오프라인 결석 카운터가 **남는 것**이 의도된 동작이다(복귀에 실패한 사람은
   * 복귀한 것이 아니다).
   */
  async reconnect(roomCode: string, playerId: string): Promise<WsRoomSnapshot> {
    const snapshot = await this.reconnectSnapshots.snapshot(roomCode, playerId)
    this.timers.clearOfflineMisses(roomCode, playerId)
    return snapshot
  }

  /** 타이머만 끊는다 — 진행 상태는 남긴다(새로고침으로 돌아올 수 있다). */
  async pause(roomCode: string): Promise<void> {
    await this.timers.cancelRoom(roomCode)
  }

  /**
   * **미완료 상태가 있을 때만** 타이머를 재무장한다. 끝난 게임을 되살리지 않는다.
   *
   * 여기서 `start`를 부르는 것(= 새 25초)이 의도다. 이 경로는 "모두 접속이 끊겨
   * 시계를 멈춰 둔 방에 누가 돌아왔다"이고, 멈춰 둔 시계를 원래 마감으로 되살리면
   * 돌아온 사람의 턴이 그 자리에서 만료된다. 재시작 복구는 `rehydrate`가 맡는다.
   */
  async resume(roomCode: string): Promise<void> {
    const state = await this.rounds.findByRoomId(roomCode)
    if (state === undefined || state.finished) return
    await this.timers.start(roomCode, state)
  }

  /**
   * 프로세스 재시작 후의 복구(PR 6). **저장된 마감을 그대로 되살린다.**
   *
   * 이어갈 수 없는 세 경우는 전부 던진다 — 호출자가 그 방만 닫는다:
   * ① 라운드 상태가 없다(진행 중이라던 방에 게임이 없다),
   * ② 라운드 상태가 이미 끝났다(종료 전이가 실패한 채 남은 방이다),
   * ③ 저장된 마감이 없거나 라운드 번호가 어긋난다.
   */
  async rehydrate(roomCode: string): Promise<void> {
    const state = await this.rounds.findByRoomId(roomCode)
    if (state === undefined) {
      throw new Error(`진행 중이라던 방에 야추 라운드 상태가 없습니다: ${roomCode}`)
    }
    if (state.finished) {
      throw new Error(`야추 라운드가 이미 끝난 방입니다(종료 전이 실패): ${roomCode}`)
    }
    if (!(await this.timers.resumeFromStored(roomCode, state))) {
      throw new Error(`되살릴 턴 마감 기록이 없습니다: ${roomCode}`)
    }
  }

  /** 게임 중 이탈 — 명단·턴 순서·다음 턴 판단은 전부 타이머의 단일 경로에 있다. */
  async removePlayer(roomCode: string, playerId: string): Promise<void> {
    await this.timers.removePlayer(roomCode, playerId)
  }

  /** 방 소멸. 여기서는 phase를 옮기지 않는다(방 자체가 사라진다). */
  async close(roomCode: string): Promise<void> {
    await this.timers.cancelRoom(roomCode)
    await this.rounds.remove(roomCode)
  }

  /** 진행 중 게임 존재 여부 — 빈 방 유예 30초/10분 선택의 근거. */
  async hasState(roomCode: string): Promise<boolean> {
    return (await this.rounds.findByRoomId(roomCode)) !== undefined
  }

  /* --------------------------------------------------------------- 메시지 라우팅 */

  handles(eventType: string): boolean {
    return isYachtInboundEvent(eventType)
  }

  async handle(socket: ClientSocket, message: InboundEnvelope): Promise<void> {
    switch (message.type) {
      case 'dice.roll':
        return this.roll(socket, message)
      case 'dice.hold':
        return this.hold(socket, message)
      case 'dice.shake':
        return this.shakeDice(socket, message)
      case 'dice.throw':
        return this.throwDice(socket, message)
      case 'round.submit':
        return this.submit(socket, message)
      default:
        // `handles`가 걸러 주므로 dispatch 경로로는 도달할 수 없다.
        throw new DomainError('unsupported_game_message')
    }
  }

  private async roll(socket: ClientSocket, message: InboundEnvelope): Promise<void> {
    const seat = this.seatOf(socket, message)
    if (seat === null) return
    const parsed = diceRollPayloadSchema.safeParse(message.payload)
    if (!parsed.success) {
      this.sendError(socket, 'INVALID_MESSAGE', 'dice.roll payload가 올바르지 않습니다.', message)
      return
    }
    try {
      await this.actions.roll(
        seat.roomId,
        seat.playerId,
        toDiceRollPayload(parsed.data),
        message.msgId ?? null,
      )
    } catch (error) {
      this.sendDomainError(socket, message, error)
    }
  }

  private async hold(socket: ClientSocket, message: InboundEnvelope): Promise<void> {
    const seat = this.seatOf(socket, message)
    if (seat === null) return
    const parsed = diceHoldPayloadSchema.safeParse(message.payload)
    if (!parsed.success) {
      this.sendError(socket, 'INVALID_MESSAGE', 'dice.hold payload가 올바르지 않습니다.', message)
      return
    }
    try {
      await this.actions.hold(
        seat.roomId,
        seat.playerId,
        toDiceHoldPayload(parsed.data),
        message.msgId ?? null,
      )
    } catch (error) {
      this.sendDomainError(socket, message, error)
    }
  }

  /**
   * `dice.shake` → `dice.shaken` 순수 연출 릴레이. 라운드 상태를 건드리지 않는다.
   *
   * **비활성 플레이어에게는 아무 응답도 주지 않는다**(무음 드롭). 방향이 바뀔 때마다
   * 올라오는 고빈도 메시지라, 턴이 넘어가는 찰나에 남은 펄스가 몇 개 도착하는 것이
   * 정상이다 — 매번 오류를 돌려주면 그 순간 오류만 쏟아진다. `dice.throw`와의 이
   * **비대칭이 계약**이다(docs/design/games/yacht.md).
   *
   * payload 검증이 활성 판정보다 **먼저**다: 남의 턴에 깨진
   * shake를 보내면 무음이 아니라 `INVALID_MESSAGE`가 나간다.
   */
  private async shakeDice(socket: ClientSocket, message: InboundEnvelope): Promise<void> {
    const seat = this.seatOf(socket, message)
    if (seat === null) return
    const parsed = diceShakePayloadSchema.safeParse(message.payload)
    if (!parsed.success) {
      this.sendError(socket, 'INVALID_MESSAGE', 'dice.shake payload가 올바르지 않습니다.', message)
      return
    }
    if (!(await this.isActivePlayer(seat))) return
    const payload = toDiceShakeRequest(parsed.data)
    this.broadcaster.broadcast(seat.roomId, {
      type: yachtWsType('dice.shaken'),
      ts: this.now(),
      payload: {
        playerId: seat.playerId,
        roundNumber: payload.roundNumber,
        direction: payload.direction,
        strength: payload.strength,
      },
      roomId: seat.roomId,
      msgId: message.msgId ?? undefined,
    })
  }

  /**
   * `dice.throw` → `dice.thrown` 순수 연출 릴레이("지금 쏟아라"). 주사위 눈은
   * `dice.roll`에서 이미 확정됐으므로 상태를 건드리지 않고, 유실돼도 진행은
   * 어긋나지 않는다.
   *
   * shake와 달리 비활성 플레이어에게는 `NOT_YOUR_TURN`을 돌려준다 — **남의 그릇을
   * 대신 엎는** 신호라 조용히 버리면 안 된다.
   */
  private async throwDice(socket: ClientSocket, message: InboundEnvelope): Promise<void> {
    const seat = this.seatOf(socket, message)
    if (seat === null) return
    const parsed = diceThrowPayloadSchema.safeParse(message.payload)
    if (!parsed.success) {
      this.sendError(socket, 'INVALID_MESSAGE', 'dice.throw payload가 올바르지 않습니다.', message)
      return
    }
    if (!(await this.isActivePlayer(seat))) {
      this.sendError(socket, 'NOT_YOUR_TURN', '현재 턴의 플레이어만 던질 수 있습니다.', message)
      return
    }
    const payload = toDiceThrowRequest(parsed.data)
    this.broadcaster.broadcast(seat.roomId, {
      type: yachtWsType('dice.thrown'),
      ts: this.now(),
      payload: {
        playerId: seat.playerId,
        roundNumber: payload.roundNumber,
        rollCount: payload.rollCount,
      },
      roomId: seat.roomId,
      msgId: message.msgId ?? undefined,
    })
  }

  private async submit(socket: ClientSocket, message: InboundEnvelope): Promise<void> {
    const seat = this.seatOf(socket, message)
    if (seat === null) return
    const parsed = roundSubmitPayloadSchema.safeParse(message.payload)
    if (!parsed.success) {
      this.sendError(
        socket,
        'INVALID_MESSAGE',
        'round.submit payload가 올바르지 않습니다.',
        message,
      )
      return
    }
    try {
      await this.actions.submitScore(
        seat.roomId,
        seat.playerId,
        toRoundSubmitPayload(parsed.data),
        message.msgId ?? null,
      )
    } catch (error) {
      this.sendDomainError(socket, message, error)
    }
  }

  /* --------------------------------------------------------------- 공통 보조 */

  /**
   * 라운드 상태가 없으면 "활성 아님"이다 — 게임이 시작되기
   * 전이나 끝난 뒤의 연출 신호가 릴레이되지 않는다.
   */
  private async isActivePlayer(seat: Seat): Promise<boolean> {
    const state = await this.rounds.findByRoomId(seat.roomId)
    return state !== undefined && state.activePlayerId === seat.playerId
  }

  /**
   * 봉투의 `roomId`가 **이 소켓의 방과 같은지** 확인한다. 다르면 `NOT_IN_ROOM` —
   * 다른 방의 게임을 조작하는 경로를 막는 유일한 검사다.
   */
  private seatOf(socket: ClientSocket, message: InboundEnvelope): Seat | null {
    const member = this.seats.of(socket)
    const roomId = message.roomId ?? ''
    if (roomId.trim().length === 0 || member === null || roomId !== member.roomId) {
      this.sendError(socket, 'NOT_IN_ROOM', '현재 참가 중인 방에서만 보낼 수 있습니다.', message)
      return null
    }
    return { playerId: member.playerId, roomId: member.roomId }
  }

  private async broadcastState(roomCode: string): Promise<void> {
    const snapshot = await this.realtimeSnapshots.snapshot(roomCode)
    this.broadcaster.broadcast(roomCode, {
      type: yachtWsType('state.sync'),
      ts: this.now(),
      payload: { snapshot },
      roomId: roomCode,
    })
  }

  /**
   * 도메인 오류 → WS 오류 응답. **모듈이 자기 응답을 직접 보내는 것이 계약**이다
   * (`registry.dispatch`는 예외를 잡지 않는다).
   *
   * 여기서 다루지 않는 예외는 **그대로 올린다** — 예: 방 락 경합의
   * `game_state_busy`(`ConflictError`). 이것을 잡지 않아
   * 응답 없이 로그만 남으므로, 새 오류 응답을 만들면 계약이 넓어진다. 우리 쪽에서는
   * 게이트웨이가 잡아 로그를 남기고 소켓을 살려 둔다(같은 관측 결과).
   */
  private sendDomainError(socket: ClientSocket, message: InboundEnvelope, error: unknown): void {
    if (error instanceof ScoreConfirmationError) {
      this.sendError(socket, scoreErrorCode(error.reason), error.message, message)
      return
    }
    if (error instanceof RoundSynchronizationError) {
      this.sendError(socket, roundErrorCode(error.reason), error.message, message)
      return
    }
    // 점수 도메인의 인자 검증과
    // 코드 문자열 도메인 오류가 여기 들어온다.
    if (error instanceof ScoreDomainError || error instanceof DomainError) {
      this.sendError(socket, 'INVALID_MESSAGE', error.message, message)
      return
    }
    throw error
  }

  /** `error` 봉투에는 roomId·msgId를 싣지 않는다 — payload의 `refMsgId`로 짝을 맞춘다. */
  private sendError(
    socket: ClientSocket,
    code: WsErrorCode,
    text: string,
    request: InboundEnvelope,
  ): void {
    if (!isOpen(socket)) return
    // refMsgId가 undefined면 `JSON.stringify`가 필드를 지운다.
    const frame = JSON.stringify({
      type: 'error',
      ts: this.now(),
      payload: { code, message: text, refMsgId: request.msgId },
    })
    try {
      socket.send(frame)
    } catch {
      // 전송 실패는 삼킨다 — 죽은 소켓 하나 때문에 상태 전이 결과를 잃지 않는다.
    }
  }
}

/**
 * 턴 순서 = **host 우선, 나머지는 Redis 명단 순서 유지**(안정 정렬의
 * 안정 정렬 자리 — `Array.prototype.sort`도 안정 정렬이다).
 */
const turnOrderOf = (game: GameStartResult): string[] =>
  [...game.snapshot.players]
    .sort(
      (left, right) =>
        hostRank(left.playerId, game.snapshot.hostId) -
        hostRank(right.playerId, game.snapshot.hostId),
    )
    .map((player) => player.playerId)

const hostRank = (playerId: string, hostId: string | null): number => (playerId === hostId ? 0 : 1)

/** 라운드 동기화 이유 코드 → WS 오류 코드. */
const roundErrorCode = (reason: RoundSyncReason): WsErrorCode => {
  switch (reason) {
    case 'PLAYER_NOT_IN_ROUND':
      return 'NOT_IN_ROOM'
    case 'NOT_ACTIVE_PLAYER':
    case 'ALREADY_SUBMITTED':
      return 'NOT_YOUR_TURN'
    case 'ROUND_NOT_INITIALIZED':
      return 'INTERNAL'
    default:
      return 'INVALID_MESSAGE'
  }
}

/** 점수 확정 이유 코드 → WS 오류 코드. */
const scoreErrorCode = (reason: ScoreConfirmationReason): WsErrorCode => {
  switch (reason) {
    case 'GAME_NOT_FOUND':
      return 'ROOM_NOT_FOUND'
    case 'PLAYER_NOT_IN_GAME':
      return 'NOT_IN_ROOM'
    case 'STORE_FAILURE':
      return 'INTERNAL'
    default:
      return 'INVALID_MESSAGE'
  }
}
