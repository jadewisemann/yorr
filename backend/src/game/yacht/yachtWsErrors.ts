import { DomainError } from '../../errors.js'
import type { InboundEnvelope } from '../../ws/envelope.js'
import type { WsErrorCode } from '../../ws/protocol.js'
import { type ClientSocket, isOpen } from '../../ws/socket.js'
import { RoundSynchronizationError, type RoundSyncReason } from '../round/index.js'
import {
  ScoreConfirmationError,
  type ScoreConfirmationReason,
  ScoreDomainError,
} from '../score/index.js'

/**
 * 야추 모듈의 **WS 오류 응답** — 도메인 오류를 와이어 코드로 옮기고 봉투를 보낸다.
 *
 * 모듈에서 갈라 둔 이유: 이유 코드 → WS 코드 매핑표는 라우팅과 무관한 표다.
 * 매핑을 바꿀 때 라우팅을 지나치지 않도록 여기에 모은다.
 */
export interface WsErrorSenderDeps {
  readonly now: () => number
}

export class WsErrorSender {
  constructor(private readonly deps: WsErrorSenderDeps) {}

  /**
   * 도메인 오류 → WS 오류 응답. **모듈이 자기 응답을 직접 보내는 것이 계약**이다
   * (`registry.dispatch`는 예외를 잡지 않는다).
   *
   * 여기서 다루지 않는 예외는 **그대로 올린다** — 예: 방 락 경합의
   * `game_state_busy`(`ConflictError`). 이것을 잡지 않아 응답 없이 로그만 남으므로,
   * 새 오류 응답을 만들면 계약이 넓어진다. 우리 쪽에서는 게이트웨이가 잡아 로그를
   * 남기고 소켓을 살려 둔다(같은 관측 결과).
   */
  sendDomainError(socket: ClientSocket, message: InboundEnvelope, error: unknown): void {
    if (error instanceof ScoreConfirmationError) {
      this.send(socket, scoreErrorCode(error.reason), error.message, message)
      return
    }
    if (error instanceof RoundSynchronizationError) {
      this.send(socket, roundErrorCode(error.reason), error.message, message)
      return
    }
    // 점수 도메인의 인자 검증과 코드 문자열 도메인 오류가 여기 들어온다.
    if (error instanceof ScoreDomainError || error instanceof DomainError) {
      this.send(socket, 'INVALID_MESSAGE', error.message, message)
      return
    }
    throw error
  }

  /** `error` 봉투에는 roomId·msgId를 싣지 않는다 — payload의 `refMsgId`로 짝을 맞춘다. */
  send(socket: ClientSocket, code: WsErrorCode, text: string, request?: InboundEnvelope): void {
    if (!isOpen(socket)) return
    // refMsgId가 undefined면 `JSON.stringify`가 필드를 지운다.
    const frame = JSON.stringify({
      type: 'error',
      ts: this.deps.now(),
      payload: { code, message: text, refMsgId: request?.msgId },
    })
    try {
      socket.send(frame)
    } catch {
      // 전송 실패는 삼킨다 — 죽은 소켓 하나 때문에 상태 전이 결과를 잃지 않는다.
    }
  }
}

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
