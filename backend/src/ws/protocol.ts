import type { ParticipantKind, RoomPhase } from '../room/snapshot.js'

/**
 * WebSocket 와이어 상수·타입. **정본은 `frontend/src/realtime/wsEvents.ts`다**
 * (docs/design/realtime.md).
 */
export const WS_PROTOCOL_VERSION = 1

/** 클라이언트가 이 간격으로 `sys.ping`을 보낸다. 서버는 먼저 ping하지 않는다. */
export const HEARTBEAT_INTERVAL_MS = 30_000

export const HEARTBEAT_TIMEOUT_MULTIPLIER = 3

/** 3회 미스(90초)면 idle_timeout. 경계는 "이상"이다 — 89_999ms는 생존한다. */
export const HEARTBEAT_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * HEARTBEAT_TIMEOUT_MULTIPLIER

/**
 * 서버가 소켓을 닫을 때 쓰는 유일한 close code.
 * 하트비트 타임아웃과 소켓 교체 두 경우뿐이다.
 */
export const WS_CLOSE_POLICY_VIOLATION = 1008

/**
 * 인바운드 메시지 크기 상한. 8KB 기준에
 * 기대고 아무것도 정하지 않았지만, `ws`의 기본값은 100MB라 그대로 두면 소켓 하나가
 * 힙을 먹을 수 있다. 지금 가장 큰 메시지는 재접속 스냅샷(수 KB)이므로 넉넉히 64KB.
 * 초과 프레임은 `ws`가 close 1009로 끊는다.
 */
export const WS_MAX_MESSAGE_BYTES = 64 * 1024

/** WS 스냅샷의 phase는 소문자다 — REST 스냅샷(대문자)과 다른 것이 계약이다. */
export type WsRoomPhase = 'waiting' | 'playing' | 'finished'

export type PlayerStatus = 'online' | 'away' | 'offline'

/** 실제로 전송되는 것은 `idle_timeout`·`replaced_by_new_session` 둘뿐이다. */
export type DisconnectReason =
  | 'server_shutdown'
  | 'kicked'
  | 'idle_timeout'
  | 'replaced_by_new_session'
  | 'protocol_error'

/**
 * `error` 봉투의 code. 이 문자열 자체가 와이어 계약이다.
 * `AUTH_FAILED`·`ROOM_FULL`·`ALREADY_IN_ROOM`은 선언만 있고 전송된 적이 없다
 * (정원은 REST가 판정한다) — 계약 목록이라 그대로 둔다. `RATE_LIMITED`는
 * 채팅 도배 판정에서 실제로 나간다(docs/design/chat.md).
 */
export type WsErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_FAILED'
  | 'SESSION_EXPIRED'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'NOT_IN_ROOM'
  | 'ALREADY_IN_ROOM'
  | 'GAME_ALREADY_STARTED'
  | 'NOT_YOUR_TURN'
  | 'INVALID_MESSAGE'
  | 'RATE_LIMITED'
  | 'INTERNAL'

/**
 * `chat.send` 한 줄의 글자 수 상한. 정본은 프론트 `wsEvents.ts`의 `CHAT_TEXT_MAX_LENGTH`다.
 * 넘으면 자르지 않고 `INVALID_MESSAGE`로 거절한다(docs/design/chat.md).
 */
export const CHAT_TEXT_MAX_LENGTH = 200

export const REACTION_TYPES = ['like', 'laugh', 'shock', 'clap', 'gg'] as const

export type ReactionType = (typeof REACTION_TYPES)[number]

export interface WsPlayer {
  readonly playerId: string
  readonly nickname: string
  readonly status: PlayerStatus
  readonly isHost: boolean
  readonly kind: ParticipantKind
}

/**
 * `room.joined`·`state.sync`·`sys.reconnected`가 싣는 방 스냅샷.
 *
 * null인 필드는 **JSON에서 생략**된다 —
 * `JSON.stringify`가 `undefined` 속성을 지우므로 undefined로 두면 같은 결과다.
 */
export interface WsRoomSnapshot {
  readonly roomId: string
  readonly gameCode?: string | undefined
  readonly phase: WsRoomPhase
  readonly hostId?: string | undefined
  readonly players: readonly WsPlayer[]
  /** 게임별 상태. 진행 중 재접속에서만 채운다 — 대기실에서는 생략한다. */
  readonly game?: unknown
  readonly capacity?: number | undefined
}

/** Redis phase(대문자) → WS phase(소문자). LOBBY가 `waiting`이 되는 것이 계약이다. */
export const toWsPhase = (phase: RoomPhase): WsRoomPhase => {
  switch (phase) {
    case 'LOBBY':
      return 'waiting'
    case 'PLAYING':
      return 'playing'
    case 'FINISHED':
      return 'finished'
  }
}
