import type { WsRoomSnapshot } from '../../../ws/protocol.js'
import type { ClientSocket } from '../../../ws/socket.js'
import type { RoundState, TurnAdvanceInput } from '../../round/index.js'
import {
  createScoreBoard,
  type ScoreBoard,
  type ScoreBoardStore,
  type ScoreCategory,
  ScoreConfirmationError,
} from '../../score/index.js'
import type {
  YachtBroadcaster,
  YachtOutboundEnvelope,
  YachtRealtimeSnapshots,
  YachtReconnectSnapshots,
  YachtRoundTimer,
} from '../yachtPorts.js'

/**
 * 3.1 스위트가 공유하는 테스트 대역. Java 테스트의 `mock(RoundTimerService)`·
 * `mock(ScoreConfirmationService)`·`mock(WebSocketSession)` 자리다.
 *
 * 실시간 sleep도 가짜 타이머도 쓰지 않는다 — 마감 발화는 이 티켓의 범위가 아니고
 * (2.5가 이미 덮었다), 여기서는 "모듈이 타이머를 불렀는가"만 관측한다.
 */

/** 전송 프레임만 기록하는 소켓 — Java `mock(WebSocketSession)` 자리. */
export class FakeSocket implements ClientSocket {
  readyState = 1
  readonly frames: string[] = []
  closed: number | null = null

  send(data: string): void {
    this.frames.push(data)
  }

  close(code?: number): void {
    this.closed = code ?? 1000
    this.readyState = 3
  }

  /** 마지막으로 받은 프레임을 파싱한다. 하나도 없으면 던진다(테스트 실수 방어). */
  last(): { type: string; ts: number; payload: Record<string, unknown> } {
    const frame = this.frames.at(-1)
    if (frame === undefined) throw new Error('전송된 프레임이 없다')
    return JSON.parse(frame)
  }

  reset(): void {
    this.frames.length = 0
  }
}

export interface RecordedBroadcast {
  readonly roomId: string
  readonly message: YachtOutboundEnvelope
}

export class RecordingBroadcaster implements YachtBroadcaster {
  readonly sent: RecordedBroadcast[] = []

  broadcast(roomId: string, message: YachtOutboundEnvelope): void {
    this.sent.push({ roomId, message })
  }

  reset(): void {
    this.sent.length = 0
  }

  messagesFor(roomId: string): YachtOutboundEnvelope[] {
    return this.sent.filter((entry) => entry.roomId === roomId).map((entry) => entry.message)
  }

  typesFor(roomId: string): string[] {
    return this.messagesFor(roomId).map((message) => message.type)
  }

  /** 이 방으로 나간 마지막 그 타입의 봉투. */
  lastOf(roomId: string, type: string): YachtOutboundEnvelope {
    const message = this.messagesFor(roomId)
      .filter((entry) => entry.type === type)
      .at(-1)
    if (message === undefined) throw new Error(`방송되지 않은 타입: ${type}`)
    return message
  }
}

/** `RoundTimerService`의 자리 — 호출만 기록한다. */
export class FakeRoundTimer implements YachtRoundTimer {
  readonly started: { roomId: string; state: RoundState }[] = []
  /** 부팅 재무장(`resumeFromStored`)이 실제로 불렸는지 — `start`와 구별해 기록한다. */
  readonly resumed: { roomId: string; state: RoundState }[] = []
  readonly advanced: { roomId: string; result: TurnAdvanceInput; msgId: string | null }[] = []
  /** `resumeFromStored`가 돌려줄 값. false면 "되살릴 마감 기록이 없다"다. */
  resumable = true
  readonly cancelledRooms: string[] = []
  readonly removed: { roomId: string; playerId: string }[] = []
  readonly clearedMisses: { roomId: string; playerId: string }[] = []

  async start(roomId: string, state: RoundState): Promise<number | null> {
    this.started.push({ roomId, state })
    return 0
  }

  /** 되살릴 기록이 있다고 답한다. 없는 경우는 `resumable = false`로 만든다. */
  async resumeFromStored(roomId: string, state: RoundState): Promise<boolean> {
    this.resumed.push({ roomId, state })
    return this.resumable
  }

  async advanceTurn(
    roomId: string,
    result: TurnAdvanceInput,
    requestMsgId: string | null,
  ): Promise<void> {
    this.advanced.push({ roomId, result, msgId: requestMsgId })
  }

  async cancelRoom(roomId: string): Promise<void> {
    this.cancelledRooms.push(roomId)
  }

  async removePlayer(roomId: string, playerId: string): Promise<void> {
    this.removed.push({ roomId, playerId })
  }

  clearOfflineMisses(roomId: string, playerId: string): void {
    this.clearedMisses.push({ roomId, playerId })
  }

  reset(): void {
    this.started.length = 0
    this.resumed.length = 0
    this.advanced.length = 0
    this.cancelledRooms.length = 0
    this.removed.length = 0
    this.clearedMisses.length = 0
  }
}

/**
 * `ScoreBoardStore`의 자리. Java 테스트가 `ScoreConfirmationService`를 모킹한 것과
 * 달리 **진짜 확정 서비스**를 쓰고 저장소만 대역으로 둔다 — 그래야 카테고리 파싱·
 * 서버 재계산·시그니처 같은 2.6 계약이 이 경로에서도 실제로 돈다.
 */
export class FakeScoreBoardStore implements ScoreBoardStore {
  readonly confirmed: {
    gameId: string
    playerId: string
    roundNumber: number
    category: ScoreCategory
    score: number
    signature: string
  }[] = []
  /** 설정하면 `confirmScore`가 던진다 — 점수 저장 실패 경로 재현. */
  failure: Error | null = null

  async confirmScore(
    gameId: string,
    playerId: string,
    roundNumber: number,
    category: ScoreCategory,
    score: number,
    requestSignature: string,
  ): Promise<ScoreBoard> {
    if (this.failure !== null) throw this.failure
    this.confirmed.push({
      gameId,
      playerId,
      roundNumber,
      category,
      score,
      signature: requestSignature,
    })
    return createScoreBoard({ [category]: score }, 0, 0, score)
  }

  async findScoreBoard(): Promise<ScoreBoard> {
    return createScoreBoard({}, 0, 0, 0)
  }

  failWith(reason: 'STORE_FAILURE', message = 'redis unavailable'): void {
    this.failure = new ScoreConfirmationError(reason, message)
  }
}

/** `RealtimeRoomSnapshotService`의 자리 — `state.sync`에 실릴 스냅샷만 돌려준다. */
export class FakeRealtimeSnapshots implements YachtRealtimeSnapshots<WsRoomSnapshot> {
  readonly calls: string[] = []
  phase: WsRoomSnapshot['phase'] = 'playing'

  async snapshot(roomId: string): Promise<WsRoomSnapshot> {
    this.calls.push(roomId)
    return { roomId, gameCode: 'YACHT_DICE', phase: this.phase, players: [] }
  }
}

/** `GameReconnectSnapshotService`의 자리(2.8). 순서 검증용으로 호출 시각을 남긴다. */
export class FakeReconnectSnapshots implements YachtReconnectSnapshots<WsRoomSnapshot> {
  readonly calls: { roomId: string; playerId: string }[] = []
  failure: Error | null = null

  async snapshot(roomId: string, playerId: string): Promise<WsRoomSnapshot> {
    this.calls.push({ roomId, playerId })
    if (this.failure !== null) throw this.failure
    return {
      roomId,
      gameCode: 'YACHT_DICE',
      phase: 'playing',
      players: [],
      game: { roundNumber: 1 },
    }
  }
}

export const NO_HELD: readonly boolean[] = [false, false, false, false, false]
