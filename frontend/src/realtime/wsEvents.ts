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

/**
 * C→S: **파티 모드에서 대시보드가 판정한 상태**(ADR-0003). 서버는 랠리를 다시 계산하지
 * 않고 검증만 한 뒤 방에 `game.ping_pong.state`로 뿌리고, `FINISHED`면 보고된 점수로
 * 완료 경로를 탄다.
 *
 * 서버가 보는 것 넷: 보낸 사람이 플레이어가 **아닐 것**(대시보드는 명단에 없다),
 * `version`이 증가할 것, `playerOrder`가 서버 것과 같을 것, 끝난 판이 아닐 것.
 * 그 밖의 판정은 하지 않는다 — 그것이 이 계약의 뜻이다.
 */
export type PingPongHostStatePayload = PingPongState

/**
 * S→C: 링크가 없는 폰의 스윙을 **대시보드에게 전달**하는 방송. 파티 모드에서만 나간다.
 *
 * 방 전체 방송인 이유는 서버가 대시보드를 특정하지 않기 때문이고, 컨트롤러는 이 메시지를
 * 무시하면 된다. 이것이 있어야 **링크가 없어도 파티 탁구가 성립한다**(ADR-0003).
 */
export interface PingPongSwungPayload {
  playerId: PlayerId
  inputSeq: number
  clientTs: number
}

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

export type DavinciTileColor = 'BLACK' | 'WHITE'
export type DavinciPhase = 'GUESSING' | 'DECIDING' | 'PLACING' | 'FINISHED'
export type DavinciEventKind = 'GUESS' | 'TIMEOUT' | 'FORFEIT'
export type DavinciDecision = 'CONTINUE' | 'STOP'

/** 조커의 숫자 자리. 실제 타일 숫자는 0~11이라 음수와 겹치지 않는다. */
export const DAVINCI_JOKER = -1

/**
 * 타일 하나. **색은 처음부터 보이고 숨는 것은 숫자뿐**이라, `number`가 null이면
 * "아직 아무도 못 맞힌 남의 타일"이라는 뜻이다.
 *
 * `id`는 서버가 섞은 뒤 붙인 자리 번호(`T0`~`T25`)라 숫자를 되짚을 수 없다 —
 * 추측을 보낼 때 타일을 가리키는 값이기도 하다.
 */
export interface DavinciTile {
  id: string
  color: DavinciTileColor
  number: number | null
  revealed: boolean
}

export interface DavinciEvent {
  kind: DavinciEventKind
  actorId: PlayerId
  targetId?: PlayerId | null
  tileId?: string | null
  number?: number | null
  correct: boolean
  at: number
}

/**
 * S→C: **보는 사람마다 다른** 판의 모습.
 *
 * 다른 게임의 상태 방송과 갈리는 유일한 지점이다. 서버는 이 게임에서만 방 전체에
 * 같은 프레임을 쏘지 않고 좌석마다 숫자를 깎아 따로 보낸다 — 감춘 숫자를 한 프레임에
 * 실으면 개발자 도구를 연 사람이 판을 다 알게 된다.
 */
export interface DavinciView {
  version: number
  phase: DavinciPhase
  playerOrder: PlayerId[]
  turnPlayerId: PlayerId
  hands: Record<PlayerId, DavinciTile[]>
  deckCount: number
  /** 이번 턴에 뽑아 아직 손에 넣지 않은 타일. 색은 모두에게, 숫자는 뽑은 사람에게만. */
  drawn?: DavinciTile | null
  turn: number
  eliminated: PlayerId[]
  winnerId?: PlayerId | null
  /** 맞혀서 공개시킨 상대 타일 수. 점수의 절반이다. */
  hits: Record<PlayerId, number>
  lastInputSeq: Record<PlayerId, number>
  nextActionAt: number
  lastEvent?: DavinciEvent | null
}

export interface DavinciGuessPayload {
  inputSeq: number
  targetId: PlayerId
  tileId: string
  /** 0~11, 조커는 {@link DAVINCI_JOKER}. */
  number: number
}

export interface DavinciDecidePayload {
  inputSeq: number
  decision: DavinciDecision
}

/** `index`는 손패 왼쪽부터의 삽입 자리(0부터 손패 길이까지). */
export interface DavinciPlacePayload {
  inputSeq: number
  index: number
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

/**
 * 컨트롤러 링크(`realtime/controllerLink/`) 협상 데이터 — 파티 대시보드와 컨트롤러 폰
 * 사이의 WebRTC DataChannel을 세운다.
 *
 * **서버는 이 값을 파싱하지 않고 봉투만 보고 배달한다**(backend `ws/controllerSignal.ts` —
 * `data`가 `z.unknown()`이다). 그래서 이 union은 서버가 아니라 **클라이언트끼리의 합의**이고,
 * 갈래를 늘려도 서버는 바뀌지 않는다. 갈래를 못 알아보는 상대는 조용히 버리면 되고, 그러면
 * 링크가 안 열려 컨트롤러 입력은 그대로 WebSocket으로 간다
 * (`docs/llmwiki/controller-link.md`).
 */
export type ControllerLinkSignal =
  | { kind: 'description'; description: RTCSessionDescriptionInit }
  | { kind: 'candidate'; candidate: RTCIceCandidateInit }

/**
 * C→S: 지목한 상대에게 협상 데이터를 전달해 달라고 요청한다. `from`은 서버가 채운다
 * (클라가 주장하는 신분을 믿으면 남을 사칭할 수 있다). 상대가 이미 떠났으면 서버는 조용히
 * 버린다 — 협상 중 이탈은 정상 상황이라 에러로 만들 이유가 없다.
 *
 * ⚠️ ICE 후보는 다른 메시지보다 훨씬 잦다(연결 수립 순간에 몰린다). `chat.send` 같은
 *    기준으로 `RATE_LIMITED`를 걸면 링크가 안 붙는다 — 이 타입은 한도를 따로 잡아야 한다.
 */
export interface ControllerSignalPayload {
  to: PlayerId
  data: ControllerLinkSignal
}
export interface ControllerSignaledPayload {
  from: PlayerId
  data: ControllerLinkSignal
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
  | WsEnvelope<'ctrl.signal', ControllerSignalPayload>
  | WsEnvelope<'game.ping_pong.host_state', PingPongHostStatePayload>
  | WsEnvelope<'game.yacht_dice.dice.roll', DiceRollPayload>
  | WsEnvelope<'game.yacht_dice.dice.hold', DiceHoldPayload>
  | WsEnvelope<'game.yacht_dice.dice.shake', DiceShakePayload>
  | WsEnvelope<'game.yacht_dice.dice.throw', DiceThrowPayload>
  | WsEnvelope<'game.yacht_dice.round.submit', RoundSubmitPayload>
  | WsEnvelope<'game.ping_pong.swing', PingPongSwingPayload>
  | WsEnvelope<'game.ping_pong.ready', PingPongReadyPayload>
  | WsEnvelope<'game.duel.draw', DuelDrawPayload>
  | WsEnvelope<'game.davinci_code.guess', DavinciGuessPayload>
  | WsEnvelope<'game.davinci_code.decide', DavinciDecidePayload>
  | WsEnvelope<'game.davinci_code.place', DavinciPlacePayload>

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
  | WsEnvelope<'game.davinci_code.state.sync', StateSyncPayload>
  | WsEnvelope<'presence.update', PresenceUpdatePayload>
  | WsEnvelope<'chat.message', ChatMessagePayload>
  | WsEnvelope<'ctrl.signaled', ControllerSignaledPayload>
  | WsEnvelope<'game.ping_pong.swung', PingPongSwungPayload>
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
  | WsEnvelope<'game.davinci_code.game.over', GameOverPayload>
  | WsEnvelope<'state.patch', StatePatchPayload>
  | WsEnvelope<'game.ping_pong.state', PingPongState>
  | WsEnvelope<'game.duel.state', DuelState>
  | WsEnvelope<'game.davinci_code.state', DavinciView>

export type WsMessage = ClientMessage | ServerMessage

export type ClientMessageType = ClientMessage['type']
export type ServerMessageType = ServerMessage['type']

export function isServer<T extends ServerMessageType>(
  msg: ServerMessage,
  type: T,
): msg is Extract<ServerMessage, { type: T }> {
  return msg.type === type
}

/**
 * 서버가 보낼 봉투를 만든다. 서버 없이 도는 로컬 게임과 mock 시나리오가 쓴다 —
 * 진짜 서버에서 오는 것과 **같은 모양**이어야 화면이 두 경우를 가르지 않는다.
 *
 * `roomId`·`msgId`는 값이 없으면 필드 자체를 넣지 않는다. 방 밖 메시지에
 * `roomId: undefined`가 실리면 계약이 흐려지기 때문이다.
 */
export function buildServerMessage<T extends ServerMessage['type']>(
  type: T,
  payload: Extract<ServerMessage, { type: T }>['payload'],
  opts: { roomId?: string | undefined; msgId?: string | undefined; ts?: number | undefined } = {},
): Extract<ServerMessage, { type: T }> {
  return {
    type,
    ts: opts.ts ?? Date.now(),
    payload,
    ...(opts.roomId === undefined ? {} : { roomId: opts.roomId }),
    ...(opts.msgId === undefined ? {} : { msgId: opts.msgId }),
  } as Extract<ServerMessage, { type: T }>
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
