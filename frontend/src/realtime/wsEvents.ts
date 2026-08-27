import type { GameCode } from '@/games'
import type { DiceSet, HeldDice } from '@/yacht/domain/dice'
import type { YachtCategory } from '@/yacht/domain/scoring'

export type { DiceSet, DiceValue, HeldDice } from '@/yacht/domain/dice'
export type { YachtCategory, YachtLowerCategory, YachtUpperCategory } from '@/yacht/domain/scoring'
export {
  UPPER_BONUS_POINTS,
  UPPER_BONUS_THRESHOLD,
  YACHT_CATEGORIES,
} from '@/yacht/domain/scoring'

export const WS_PROTOCOL_VERSION = 1 as const

export type PlayerId = string
export type RoomId = string
export type SessionToken = string

export type PlayerStatus = 'online' | 'away' | 'offline'
export type ParticipantKind = 'HUMAN' | 'BOT'

export interface Player {
  playerId: PlayerId
  nickname: string
  status: PlayerStatus
  kind?: ParticipantKind
  isHost?: boolean
}

export type RoomPhase = 'waiting' | 'playing' | 'finished'

export interface RoomSnapshot {
  gameCode?: GameCode
  roomId: RoomId
  phase: RoomPhase
  players: Player[]
  hostId?: PlayerId
  capacity?: number
  game?: GameState
}

export type ReactionType = 'like' | 'laugh' | 'shock' | 'clap' | 'gg'

export interface GameState {
  roundNumber: number
  activePlayerId: PlayerId
  /**
   * 현재 턴의 마감 시각(epoch ms). **`null`이면 시계가 없는 판이다** — 봇만 데리고
   * 혼자 하는 방에서는 서버가 마감을 걸지 않고(`backend` `UNTIMED_HUMAN_LIMIT`)
   * 이 값을 null로 내려보낸다. 화면은 그때 타이머를 그리지 않는다.
   */
  roundDeadline: number | null
  scores: Record<PlayerId, ScoreBoard>
  turnOrder?: PlayerId[]
  rankings?: GameOverPayload['rankings']
  rollCount: number
  dice?: DiceSet
  held?: HeldDice
}

export type PingPongPhase = 'PREPARING' | 'COUNTDOWN' | 'PLAYING' | 'FINISHED'
export type PingPongFault = 'OUT' | 'NET'
export type PingPongEventType =
  | 'READY'
  | 'PRACTICE'
  | 'PLAYER_READY'
  | 'SERVE'
  | 'TOO_EARLY'
  | 'TOO_LATE'
  | 'OK'
  | 'NICE'
  | 'SMASH'
  | 'OUT'
  | 'NET'
  | 'POINT'
  | 'GAME_OVER'
  | 'OPPONENT_LEFT'

export interface PingPongBallState {
  pos: number
  direction: 1 | -1
  speed: number
  smash: boolean
  fault?: PingPongFault | null
  faultFrom: number
  x0: number
  x1: number
  launchedAt: number
}

export interface PingPongEvent {
  id: number
  type: PingPongEventType
  playerId?: PlayerId | null
  at: number
}

export interface PingPongState {
  version: number
  phase: PingPongPhase
  playerOrder: PlayerId[]
  scores: Record<PlayerId, number>
  lastInputSeq: Record<PlayerId, number>
  readyPlayerIds: PlayerId[]
  ball: PingPongBallState
  rally: number
  serveReceiverId?: PlayerId | null
  nextActionAt: number
  lastEvent?: PingPongEvent | null
}

export interface PingPongSwingPayload {
  inputSeq: number
  clientTs: number
}

export type PingPongReadyPayload = Record<string, never>

export type DuelPhase = 'WAITING' | 'SIGNAL' | 'RESULT' | 'FINISHED'
export type DuelRoundKind = 'SHOT' | 'TIE' | 'WARNING' | 'SELF_SHOT' | 'FORFEIT'

export const DUEL_FOUL = -1
export const DUEL_MISS = -2

export interface DuelRound {
  number: number
  kind: DuelRoundKind
  shooterId?: PlayerId | null
  hitId?: PlayerId | null
  koId?: PlayerId | null
  foulId?: PlayerId | null
  over: boolean
  at: number
}

export interface DuelState {
  version: number
  phase: DuelPhase
  playerOrder: PlayerId[]
  hp: Record<PlayerId, number>
  fouls: Record<PlayerId, number>
  reactions: Record<PlayerId, number>
  lastInputSeq: Record<PlayerId, number>
  round: number
  signalAt: number
  nextActionAt: number
  lastRound?: DuelRound | null
}

export interface DuelDrawPayload {
  inputSeq: number
  reactionMs: number
}

export interface ScoreBoard {
  categories: Record<YachtCategory, number | null>
  upperSubtotal: number
  upperBonus: number
  total: number
}

export interface WsEnvelope<TType extends string, TPayload> {
  type: TType
  ts: number
  payload: TPayload
  roomId?: RoomId
  msgId?: string
}

export interface SysPingPayload {
  clientTs: number
}
export interface SysPongPayload {
  serverTs: number
}
export interface SysConnectedPayload {
  serverTs: number
  protocolVersion: number
  heartbeatIntervalMs: number
}
export type DisconnectReason =
  | 'server_shutdown'
  | 'kicked'
  | 'idle_timeout'
  | 'replaced_by_new_session'
  | 'protocol_error'
export interface SysDisconnectPayload {
  reason: DisconnectReason
}
export interface SysReconnectPayload {
  sessionToken: SessionToken
  lastMsgId?: string
}
export interface SysReconnectedPayload {
  snapshot: RoomSnapshot
}

export interface RoomJoinPayload {
  roomId: RoomId
  nickname: string
  sessionToken: SessionToken
}
export type RoomLeavePayload = Record<string, never> // 빈 payload
export interface RoomReadyPayload {
  ready: boolean
}
export interface RoomJoinedPayload {
  you: PlayerId
  sessionToken: SessionToken
  snapshot: RoomSnapshot
}
export interface RoomPlayerJoinedPayload {
  player: Player
}
export interface RoomPlayerLeftPayload {
  playerId: PlayerId
}
export interface RoomReadyChangedPayload {
  playerId: PlayerId
  ready: boolean
}
export type RoomCloseReason =
  | 'host_left'
  | 'game_finished'
  | 'not_enough_players'
  | 'empty'
  | 'server_shutdown'
export interface RoomClosedPayload {
  reason: RoomCloseReason
}

export interface ReactionSendPayload {
  reaction: ReactionType
}
export interface ReactionBroadcastPayload {
  playerId: PlayerId
  reaction: ReactionType
}
export interface StateSyncPayload {
  snapshot: RoomSnapshot
}
export interface PresenceUpdatePayload {
  playerId: PlayerId
  status: PlayerStatus
}

/**
 * 텍스트 채팅 — 방 레벨이라 게임 네임스페이스 접두사가 없다(리액션과 같은 층).
 *
 * 서버가 중계만 하는 것이 계약이다: 저장하지 않고, 지난 대화를 다시 내려주지 않는다.
 * 그래서 늦게 들어온 사람에게는 들어온 뒤의 말만 보인다 — 방이 게임 한 판 동안만
 * 사는 수명이라 서버에 이력을 두면 방 TTL·재접속 스냅샷·정원 계산이 모두 늘어난다.
 */
export const CHAT_TEXT_MAX_LENGTH = 200

/**
 * C→S: 방 전체에 보낼 한 줄. 서버는 앞뒤 공백을 다듬고 빈 문자열을 거절하며,
 * `CHAT_TEXT_MAX_LENGTH`를 넘으면 `INVALID_MESSAGE`다(자르지 않는다 — 잘린 말이
 * 나가면 보낸 사람은 자기가 무엇을 보냈는지 모른다).
 *
 * 도배는 `RATE_LIMITED`로 막는다. 리액션과 달리 채팅은 글자가 화면에 쌓이므로
 * 한도가 없으면 한 명이 대화를 덮어 버린다.
 */
export interface ChatSendPayload {
  text: string
}

/**
 * S→C: 중계된 한 줄. `playerId`·`nickname`·`at`은 모두 **서버가 채운다** — 클라이언트가
 * 주장하는 신분을 믿으면 남을 사칭할 수 있다(`reaction.broadcast`의 `playerId`와 같은 이유).
 *
 * `nickname`을 함께 싣는 이유: 보낸 사람이 방을 떠난 뒤에도 그 말은 화면에 남아야
 * 하는데, 명단에서 지워진 playerId로는 이름을 찾을 수 없다.
 *
 * `messageId`는 서버가 만드는 방 안에서 유일한 값이다. 재전송·중복 배달에서 같은 말이
 * 두 줄로 쌓이지 않게 하는 열쇠다.
 */
export interface ChatMessagePayload {
  messageId: string
  playerId: PlayerId
  nickname: string
  text: string
  at: number
}

export interface RoundStartPayload {
  roundNumber: number
  /** epoch ms. null이면 이 턴에는 제한 시간이 없다(`GameState.roundDeadline` 참고). */
  deadline: number | null
  activePlayerId: PlayerId
  turnOrder: PlayerId[]
}
export interface RoundSubmitPayload {
  roundNumber: number
  dice: DiceSet
  category: YachtCategory
}
export interface RoundEndPayload {
  roundNumber: number
  submitted: PlayerId[]
}
export interface DiceRollPayload {
  roundNumber: number
  rollCount: 1 | 2 | 3
  held: readonly [boolean, boolean, boolean, boolean, boolean]
}
export interface DiceHoldPayload {
  roundNumber: number
  held: readonly [boolean, boolean, boolean, boolean, boolean]
}
export interface DiceHoldChangedPayload {
  playerId: PlayerId
  roundNumber: number
  held: readonly [boolean, boolean, boolean, boolean, boolean]
}
export interface DiceShakePayload {
  roundNumber: number
  direction: 'left' | 'right'
  strength: number
}
export interface DiceShakenPayload {
  playerId: PlayerId
  roundNumber: number
  direction: 'left' | 'right'
  strength: number
}
export interface DiceThrowPayload {
  roundNumber: number
  rollCount: 1 | 2 | 3
}
export interface DiceThrownPayload {
  playerId: PlayerId
  roundNumber: number
  rollCount: 1 | 2 | 3
}
export interface DiceBroadcastPayload {
  playerId: PlayerId
  roundNumber: number
  rollCount: 1 | 2 | 3
  dice: DiceSet
  held: readonly [boolean, boolean, boolean, boolean, boolean]
  auto?: boolean
}
export interface ScoreUpdatePayload {
  playerId: PlayerId
  scoreboard: ScoreBoard
}
export interface GameOverPayload {
  rankings: Array<{ rank: number; playerId: PlayerId; total: number }>
}
export interface StatePatchPayload {
  changes: Partial<GameState>
}

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

export interface ErrorPayload {
  code: WsErrorCode
  message: string
  refMsgId?: string
  context?: Record<string, unknown>
}

export type ClientMessage =
  | WsEnvelope<'sys.ping', SysPingPayload>
  | WsEnvelope<'sys.reconnect', SysReconnectPayload>
  | WsEnvelope<'room.join', RoomJoinPayload>
  | WsEnvelope<'room.leave', RoomLeavePayload>
  | WsEnvelope<'room.ready', RoomReadyPayload>
  | WsEnvelope<'reaction.send', ReactionSendPayload>
  | WsEnvelope<'chat.send', ChatSendPayload>
  | WsEnvelope<'game.yacht_dice.dice.roll', DiceRollPayload>
  | WsEnvelope<'game.yacht_dice.dice.hold', DiceHoldPayload>
  | WsEnvelope<'game.yacht_dice.dice.shake', DiceShakePayload>
  | WsEnvelope<'game.yacht_dice.dice.throw', DiceThrowPayload>
  | WsEnvelope<'game.yacht_dice.round.submit', RoundSubmitPayload>
  | WsEnvelope<'game.ping_pong.swing', PingPongSwingPayload>
  | WsEnvelope<'game.ping_pong.ready', PingPongReadyPayload>
  | WsEnvelope<'game.duel.draw', DuelDrawPayload>

export type ServerMessage =
  | WsEnvelope<'sys.connected', SysConnectedPayload>
  | WsEnvelope<'sys.pong', SysPongPayload>
  | WsEnvelope<'sys.disconnect', SysDisconnectPayload>
  | WsEnvelope<'sys.reconnected', SysReconnectedPayload>
  | WsEnvelope<'room.joined', RoomJoinedPayload>
  | WsEnvelope<'room.player_joined', RoomPlayerJoinedPayload>
  | WsEnvelope<'room.player_left', RoomPlayerLeftPayload>
  | WsEnvelope<'room.ready_changed', RoomReadyChangedPayload>
  | WsEnvelope<'room.closed', RoomClosedPayload>
  | WsEnvelope<'reaction.broadcast', ReactionBroadcastPayload>
  | WsEnvelope<'state.sync', StateSyncPayload>
  | WsEnvelope<'game.yacht_dice.state.sync', StateSyncPayload>
  | WsEnvelope<'game.ping_pong.state.sync', StateSyncPayload>
  | WsEnvelope<'game.duel.state.sync', StateSyncPayload>
  | WsEnvelope<'presence.update', PresenceUpdatePayload>
  | WsEnvelope<'chat.message', ChatMessagePayload>
  | WsEnvelope<'error', ErrorPayload>
  | WsEnvelope<'game.yacht_dice.round.start', RoundStartPayload>
  | WsEnvelope<'game.yacht_dice.round.end', RoundEndPayload>
  | WsEnvelope<'game.yacht_dice.dice.broadcast', DiceBroadcastPayload>
  | WsEnvelope<'game.yacht_dice.dice.hold_changed', DiceHoldChangedPayload>
  | WsEnvelope<'game.yacht_dice.dice.shaken', DiceShakenPayload>
  | WsEnvelope<'game.yacht_dice.dice.thrown', DiceThrownPayload>
  | WsEnvelope<'game.yacht_dice.score.update', ScoreUpdatePayload>
  | WsEnvelope<'game.yacht_dice.game.over', GameOverPayload>
  | WsEnvelope<'game.ping_pong.game.over', GameOverPayload>
  | WsEnvelope<'game.duel.game.over', GameOverPayload>
  | WsEnvelope<'state.patch', StatePatchPayload>
  | WsEnvelope<'game.ping_pong.state', PingPongState>
  | WsEnvelope<'game.duel.state', DuelState>

export type WsMessage = ClientMessage | ServerMessage

export type ClientMessageType = ClientMessage['type']
export type ServerMessageType = ServerMessage['type']

export function isServer<T extends ServerMessageType>(
  msg: ServerMessage,
  type: T,
): msg is Extract<ServerMessage, { type: T }> {
  return msg.type === type
}

export function buildClientMessage<T extends ClientMessageType>(
  type: T,
  payload: Extract<ClientMessage, { type: T }>['payload'],
  opts?: { roomId?: RoomId; msgId?: string },
): Extract<ClientMessage, { type: T }> {
  return {
    type,
    ts: Date.now(),
    payload,
    ...(opts?.roomId !== undefined ? { roomId: opts.roomId } : {}),
    ...(opts?.msgId !== undefined ? { msgId: opts.msgId } : {}),
  } as Extract<ClientMessage, { type: T }>
}
