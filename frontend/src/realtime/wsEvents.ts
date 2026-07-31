/**
 * ============================================================================
 *  ws-events.ts — YORR(요르) 실시간 WebSocket 이벤트 계약 (SSOT)
 * ============================================================================
 *
 *  이 파일은 프론트엔드(React/TS)와 백엔드(Spring/Java) 사이 오가는
 *  모든 WebSocket 메시지의 "단일 진실 원천(Single Source of Truth)"이다.
 *
 *  상태: 파일 전체가 현재 팀 합의 기준이다. 아래 STUB 표시는 미합의라는 뜻이
 *        아니라 담당 기능 개발 중 필드 변경 가능성이 있다는 뜻이다. 변경 시
 *        FE/BE 공동 검토 후 이 파일을 먼저 수정한다.
 *
 *    - FE : 이 파일을 직접 import 해서 송수신 타입으로 사용.
 *    - BE(Java) : 이 파일은 import 불가 → 동일한 `type` 문자열/필드로 DTO(record)를
 *                 미러링한다. 이 .ts 가 기준이고 Java 가 따라온다.
 *
 *  방향 규약
 *    - ClientMessage : 클라이언트 → 서버 (명령/요청)
 *    - ServerMessage : 서버 → 클라이언트 (이벤트/브로드캐스트)
 *
 *  네임스페이스 = 담당 티켓
 *    sys.*                              22(연결계열)     소켓 연결/세션 수명주기       (이정현) ✅
 *    room.*                             22 + ENT-ROOM   JOIN(인증+입장)·퇴장·멤버십   (이정현) ✅
 *    reaction.* / state.* / presence.*  26              리액션·상태 브로드캐스트      (이정현) ✅
 *    ─ 참고: 인증(구 auth.*)은 room.join 하나로 병합됨(v0.2). WebRTC는 음성(develop)으로 이관.
 *    round.*                            23·24           라운드·타이머(STUB)           (고용훈)
 *    dice.*                             16~21           센서 주사위(STUB)             (정유진/고용훈)
 *    score.* / game.*                   40·41·43        족보·점수·승패(STUB)          (유상은)
 *
 *    ※ 타이머는 round.start.deadline(epoch ms)을 내려 클라가 (deadline - now)로 계산 →
 *      별도 tick 이벤트 미사용 권장(서버 브로드캐스트 부하 제거).
 *
 *  범례
 *    ✅ CONFIRMED : 내(이정현) 담당 범위 — 이번 P0에서 확정 구현.
 *    ⚠️ STUB      : 타 담당 제안 초안 — owner 확정 전까지 임시. 필드 변경 가능.
 *
 *  history
 *    v0.1 (2026-07) 초안 — envelope + sys/auth/room/signal 확정, 게임 도메인 STUB.
 *    v0.2 (2026-07) JOIN 병합 — auth.* 제거, room.join 이 닉네임+방ID+세션 통합 처리.
 *    v0.3 (2026-07) 요트 족보 STUB 구체화 — YachtCategory 12종 키 + 상단 보너스 구조 확정.
 *                   (점수 계산값은 상은 40·41 서버 로직 소관 · 계약은 "키 이름"만 고정)
 *    v0.4 (2026-07) 점수 규칙 확정 — smallStraight=15 · largeStraight=30 · fullHouse=총합.
 *                   (fourOfAKind=총합 / 상단보너스 63→35 은 기본값, 확정 대기)
 *    v0.5 (2026-07) 요트 점수 전체 확정 — fourOfAKind=5개 총합, 상단보너스 63↑→35 잠금.
 * ============================================================================
 */

import type { DiceSet, HeldDice } from '@/domain/dice'
import type { YachtCategory } from '@/domain/scoring'

export type { DiceSet, DiceValue, HeldDice } from '@/domain/dice'
export type { YachtCategory, YachtLowerCategory, YachtUpperCategory } from '@/domain/scoring'
export {
  UPPER_BONUS_POINTS,
  UPPER_BONUS_THRESHOLD,
  YACHT_CATEGORIES,
} from '@/domain/scoring'

export const WS_PROTOCOL_VERSION = 1 as const

/* ============================================================================
 * 1. 공통 원시 타입 & 도메인 모델
 * ==========================================================================*/

export type PlayerId = string
export type RoomId = string
export type SessionToken = string

export type PlayerStatus = 'online' | 'away' | 'offline'

export interface Player {
  playerId: PlayerId
  nickname: string
  status: PlayerStatus
}

export type RoomPhase = 'waiting' | 'playing' | 'finished'

/**
 * 방 전체 스냅샷. state.sync / room.joined / sys.reconnected 가 이걸 실어 보낸다.
 * game 필드(진행 상태)는 게임 도메인 소유 → GameState 참조.
 */
export interface RoomSnapshot {
  roomId: RoomId
  phase: RoomPhase
  players: Player[]
  /** ⚠️ STUB: 게임 진행 중일 때만 존재. owner: 고용훈/유상은 */
  game?: GameState
}

/* ----- 리액션 (SIGNAL-001 · 이정현) ----- */
// 종류는 프론트 이모지 셋과 협의. 문자열 유니온으로 고정해 오타를 컴파일 타임에 차단.
export type ReactionType = 'like' | 'laugh' | 'shock' | 'clap' | 'gg'

/** ⚠️ STUB · owner: 고용훈(라운드) + 유상은(점수). 최종 필드 협의 필요. */
export interface GameState {
  roundNumber: number
  /** 서버가 지정한 현재 턴 소유자. 이 플레이어만 굴림 결과를 확정할 수 있다. */
  activePlayerId: PlayerId
  /** epoch ms. 클라가 남은시간 = deadline - now 로 계산(타이머 tick 최소화). */
  roundDeadline: number
  scores: Record<PlayerId, ScoreBoard>
  /** 서버가 확정한 턴 순서(round.start). 아직 못 받았으면 비어 있다. */
  turnOrder?: PlayerId[]
  /** game.over로 받은 최종 순위. 결과 화면은 로컬 재계산 대신 이 값을 쓴다. */
  rankings?: GameOverPayload['rankings']
  /**
   * 현재 턴에서 **서버가 확정한** 굴림 횟수. 클라가 따로 세지 않고 이 값을 권위로 쓴다.
   * 첫 굴림 전에는 0. 이 필드가 없으면 재접속한 클라가 0부터 다시 세어
   * 다음 dice.roll이 INVALID_ROLL로 거부된다.
   */
  rollCount: number
  /** 현재 턴에 놓여 있는 주사위. 첫 굴림 전에는 없다. */
  dice?: DiceSet
  /** 턴 주인이 유지 중인 KEEP. 첫 굴림 전에는 없다. */
  held?: HeldDice
}

/* ----- 요트 정규룰 족보 (score.* / game.* · owner: 유상은 40·41·43) -----
 *  ⚠️ 아래 "키 이름"은 FE 점수판·BE 채점이 하드코딩 → 확정하면 되돌리기 비쌈.
 *     반면 "점수 계산 규칙"은 서버(상은)가 수행 → 여긴 참고 주석일 뿐.
 *
 *  요트 점수 규칙 (계산은 상은 40·41 서버 소관, 아래는 참고):
 *    상단 ones~sixes : 해당 숫자 눈의 합           (예: 3이 3개 → threes = 9)
 *    choice          : 주사위 5개 총합
 *    fullHouse       : 5개 총합            ✔확정   (예: 6·6·6·3·3 → 24)
 *    smallStraight   : 연속 4개 → 15점     ✔확정
 *    largeStraight   : 연속 5개 → 30점     ✔확정
 *    yacht           : 같은 눈 5개 → 50점
 *    fourOfAKind     : 같은 눈 4개↑ → 5개 총합   ✔확정
 *    상단 보너스       : 소계 63↑ → 35점(아래 상수)  ✔확정
 *  ※ 임의 족보에 0점 기록(포기)은 category 선택 그대로 + 점수 0 처리 → 별도 필드 불필요.
 *  ※ 3 of a Kind 없음(정규룰 = 12족보, 야찌 13족보와 구분).
 */
/** 한 플레이어의 점수판. total 등 파생값은 서버가 계산해서 실어 보냄(클라 재계산 X). */
export interface ScoreBoard {
  /** 족보별 점수. null = 미기입, number = 확정(0 = 포기). */
  categories: Record<YachtCategory, number | null>
  /** 상단(ones~sixes) 소계 — 보너스 판정 근거. */
  upperSubtotal: number
  /** 상단 보너스 (소계 ≥ UPPER_BONUS_THRESHOLD 면 UPPER_BONUS_POINTS, 아니면 0). */
  upperBonus: number
  /** 총점 = 상단 소계 + 보너스 + 하단 합. */
  total: number
}

/* ============================================================================
 * 2. 봉투(Envelope) — 모든 메시지는 이 형태. type 으로 판별(discriminated union).
 * ==========================================================================*/

export interface WsEnvelope<TType extends string, TPayload> {
  /** 메시지 종류. 판별자. 예: 'room.join' */
  type: TType
  /** 서버 기준 epoch ms. 아웃바운드는 서버가 채운다. */
  ts: number
  /** 이벤트별 데이터 */
  payload: TPayload
  /**
   * 방 컨텍스트. **입장 이후** 방 스코프 메시지에 서버/클라가 채운다.
   * (room.join 은 아직 방 밖이므로 payload.roomId 로 대상 지정)
   */
  roomId?: RoomId
  /** ack/상관관계용(선택). 클라가 채우면 서버가 echo 해준다. */
  msgId?: string
}

/* ============================================================================
 * 3. Payload 정의
 * ==========================================================================*/

/* ===== SYS-DC-001 · 연결/세션 (이정현) ✅ ===== */

// C→S: 앱 레벨 하트비트. heartbeatIntervalMs 주기로 전송.
export interface SysPingPayload {
  clientTs: number
}
// S→C: 하트비트 응답.
export interface SysPongPayload {
  serverTs: number
}
// S→C: 소켓 오픈 직후 서버 인사. 인증 전에 먼저 온다.
export interface SysConnectedPayload {
  serverTs: number
  protocolVersion: number
  /** 클라 하트비트 주기(ms). 서버는 이 시간 * n 무응답 시 idle 종료. */
  heartbeatIntervalMs: number
}
// S→C: 서버가 연결을 끊기 직전 사유 통지.
export type DisconnectReason =
  | 'server_shutdown'
  | 'kicked'
  | 'idle_timeout'
  | 'replaced_by_new_session'
  | 'protocol_error'
export interface SysDisconnectPayload {
  reason: DisconnectReason
}
// C→S: 끊겼다 돌아옴. 세션 토큰 제시 → 원래 방/상태 복원 요청.
//   ⚠️ transport 는 이정현, **상태 복원 로직은 재접속 티켓(25, 박재영)** 과 공동.
export interface SysReconnectPayload {
  sessionToken: SessionToken
  /** 마지막으로 받은 msgId(있으면). 서버가 이후만 재전송할 수 있음(선택). */
  lastMsgId?: string
}
// S→C: 재접속 승인 + 전체 상태 재동기화.
export interface SysReconnectedPayload {
  snapshot: RoomSnapshot
}

/* ===== 인증(구 AUTH-001) · v0.2에서 room.join 으로 병합 =====
 *  링크/QR 입장이라 "방 없이 로그인만" 상태가 없음 → 인증+입장을 JOIN 한 번에 처리.
 *  닉네임/세션은 RoomJoinPayload 로, 발급된 playerId/세션은 RoomJoinedPayload 로 돌려준다.
 *  인증 실패는 error(code: AUTH_FAILED / SESSION_EXPIRED)로 통일.
 */

/* ===== ENT-ROOM-005/006 · 방 입장/퇴장 (이정현) ✅ ===== */

// C→S (JOIN): 인증 + 방 입장 통합. 소켓 열고 보내는 사실상 첫 메시지.
//   - roomId : 대상 방(REST로 방 생성·정원검증 27,박재영 → roomId 확보 후 여기로).
//   - sessionToken : REST 입장에서 발급된 세션을 실시간 방 채널에 연결.
//   JOIN 전 다른 메시지를 보내면 서버가 거부(error: AUTH_REQUIRED / NOT_IN_ROOM).
export interface RoomJoinPayload {
  roomId: RoomId
  nickname: string
  sessionToken: SessionToken
}
// C→S (006): 방 퇴장. roomId 는 envelope.
export type RoomLeavePayload = Record<string, never> // 빈 payload
// C→S: 대기방 준비 토글.
export interface RoomReadyPayload {
  ready: boolean
}
// S→C (JOINED): 내 입장 확정 + 발급 세션 + 전체 스냅샷. (본인에게만)
//   you = 서버가 발급한 내 playerId (티켓상 peerId → playerId로 통일 제안).
//   sessionToken = 재접속 때 다시 제시할 토큰. 클라가 저장.
export interface RoomJoinedPayload {
  you: PlayerId
  sessionToken: SessionToken
  snapshot: RoomSnapshot
}
// S→C: 다른 사람 입장(브로드캐스트).
export interface RoomPlayerJoinedPayload {
  player: Player
}
// S→C: 다른 사람 퇴장(브로드캐스트).
export interface RoomPlayerLeftPayload {
  playerId: PlayerId
}
// S→C: 준비 상태 변경(브로드캐스트).
export interface RoomReadyChangedPayload {
  playerId: PlayerId
  ready: boolean
}
// S→C: 방 종료.
export type RoomCloseReason =
  | 'host_left'
  | 'game_finished'
  | 'not_enough_players'
  | 'empty'
  | 'server_shutdown'
export interface RoomClosedPayload {
  reason: RoomCloseReason
}

/* ===== SIGNAL-001 · 리액션·상태 브로드캐스트 (이정현) ✅ ===== */

// C→S: 리액션 전송.
export interface ReactionSendPayload {
  reaction: ReactionType
}
// S→C: 리액션 브로드캐스트.
export interface ReactionBroadcastPayload {
  playerId: PlayerId
  reaction: ReactionType
}
// S→C: 전체 상태 스냅샷 브로드캐스트.
//   ⭐ MVP 권장: 상태가 작으니(2~6명) diff(state.patch) 하지 말고 이 "전체 스냅샷"만 쏜다.
//     patch 는 성능 이슈 생길 때 도입 — 지금은 STUB.
export interface StateSyncPayload {
  snapshot: RoomSnapshot
}
// S→C: 접속/이탈 등 presence 변경(브로드캐스트).
export interface PresenceUpdatePayload {
  playerId: PlayerId
  status: PlayerStatus
}

/* ===== ⚠️ STUB: 게임 도메인 — owner 확정 전 임시 초안 ===== */

// S→C ⚠️ owner 고용훈(23·24): 라운드 시작.
export interface RoundStartPayload {
  roundNumber: number
  deadline: number // epoch ms
  activePlayerId: PlayerId
  /**
   * 서버가 확정한 턴 순서. RoomSnapshot.players 순서는 서버 명단(맵) 순서라 턴 순서를 뜻하지 않는다 —
   * 상단 진행 표시는 반드시 이 값으로 그린다.
   */
  turnOrder: PlayerId[]
}
// C→S ⚠️ owner 고용훈: 이번 라운드 제출(로컬 계산된 주사위 + 기록할 족보 칸).
//   category = 요트 족보 키 중 하나(YachtCategory). 0점 기록(포기)도 같은 방식.
export interface RoundSubmitPayload {
  roundNumber: number
  dice: DiceSet
  category: YachtCategory
}
// S→C ⚠️ owner 고용훈: 라운드 종료 + 제출자 목록.
export interface RoundEndPayload {
  roundNumber: number
  submitted: PlayerId[]
}
// C→S: KEEP 상태와 굴림 순서만 요청한다. 주사위 숫자는 서버가 생성한다.
export interface DiceRollPayload {
  roundNumber: number
  rollCount: 1 | 2 | 3
  held: readonly [boolean, boolean, boolean, boolean, boolean]
}
/**
 * C→S: 굴림 사이에 KEEP을 바꿨다고 알린다.
 *
 * dice.roll 이 실어 나르는 held 는 "그 굴림에 쓴 KEEP"이라, 굴린 뒤에 바꾼 KEEP은 다음 굴림
 * 전까지 서버도 상대도 알 수 없었다. 그래서 관전자 화면의 KEEP이 실제와 달랐고, 마감 자동
 * 굴림도 낡은 KEEP으로 굴렸다. 토글이 일어난 즉시 전체 배열을 보낸다(증분이 아니라 전체 —
 * 메시지가 유실돼도 다음 토글에서 상태가 복구된다).
 */
export interface DiceHoldPayload {
  roundNumber: number
  held: readonly [boolean, boolean, boolean, boolean, boolean]
}
/** S→C: 턴 주인의 KEEP이 바뀌었다. 주사위 값은 그대로이므로 굴림 애니메이션을 트리거하지 않는다. */
export interface DiceHoldChangedPayload {
  playerId: PlayerId
  roundNumber: number
  held: readonly [boolean, boolean, boolean, boolean, boolean]
}
// S→C: 서버가 확정한 결과를 방 전체에 브로드캐스트한다.
export interface DiceBroadcastPayload {
  playerId: PlayerId
  roundNumber: number
  rollCount: 1 | 2 | 3
  dice: DiceSet
  held: readonly [boolean, boolean, boolean, boolean, boolean]
  /**
   * 마감 시각이 지나 서버가 턴 주인을 대신해 굴린 결과. 내가 보낸 dice.roll의 응답이 아니어도
   * 그대로 반영해야 한다 — 서버 상태가 이미 이 값으로 확정됐다.
   */
  auto?: boolean
}
// S→C ⚠️ owner 유상은(41): 점수 갱신.
export interface ScoreUpdatePayload {
  playerId: PlayerId
  scoreboard: ScoreBoard
}
// S→C ⚠️ owner 유상은(43): 게임 종료 + 순위.
export interface GameOverPayload {
  rankings: Array<{ rank: number; playerId: PlayerId; total: number }>
}
// S→C ⚠️ 성능 최적화 도입 시에만. 지금은 미사용(state.sync 로 대체).
export interface StatePatchPayload {
  changes: Partial<GameState>
}

/* ===== 공통 에러 ===== */
export type WsErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_FAILED'
  | 'SESSION_EXPIRED'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'NOT_IN_ROOM'
  | 'ALREADY_IN_ROOM'
  | 'GAME_ALREADY_STARTED'
  /** 내 턴이 아닌데 굴림·기록을 시도했다. 조작을 되돌리고 안내만 띄운다. */
  | 'NOT_YOUR_TURN'
  | 'INVALID_MESSAGE'
  | 'RATE_LIMITED'
  | 'INTERNAL'

export interface ErrorPayload {
  code: WsErrorCode
  message: string
  /** 문제된 원본 msgId(있으면) — 클라가 어떤 요청 실패인지 매칭. */
  refMsgId?: string
  context?: Record<string, unknown>
}

/* ============================================================================
 * 4. 메시지 유니온 (discriminated by `type`)
 * ==========================================================================*/

export type ClientMessage =
  // ✅ SYS-DC
  | WsEnvelope<'sys.ping', SysPingPayload>
  | WsEnvelope<'sys.reconnect', SysReconnectPayload>
  // ✅ ROOM (room.join = 인증+입장 통합)
  | WsEnvelope<'room.join', RoomJoinPayload>
  | WsEnvelope<'room.leave', RoomLeavePayload>
  | WsEnvelope<'room.ready', RoomReadyPayload>
  // ✅ SIGNAL
  | WsEnvelope<'reaction.send', ReactionSendPayload>
  // ⚠️ STUB (게임 도메인)
  | WsEnvelope<'dice.roll', DiceRollPayload>
  | WsEnvelope<'dice.hold', DiceHoldPayload>
  | WsEnvelope<'round.submit', RoundSubmitPayload>

export type ServerMessage =
  // ✅ SYS-DC
  | WsEnvelope<'sys.connected', SysConnectedPayload>
  | WsEnvelope<'sys.pong', SysPongPayload>
  | WsEnvelope<'sys.disconnect', SysDisconnectPayload>
  | WsEnvelope<'sys.reconnected', SysReconnectedPayload>
  // ✅ ROOM (room.joined = 입장확정+세션발급+스냅샷)
  | WsEnvelope<'room.joined', RoomJoinedPayload>
  | WsEnvelope<'room.player_joined', RoomPlayerJoinedPayload>
  | WsEnvelope<'room.player_left', RoomPlayerLeftPayload>
  | WsEnvelope<'room.ready_changed', RoomReadyChangedPayload>
  | WsEnvelope<'room.closed', RoomClosedPayload>
  // ✅ SIGNAL
  | WsEnvelope<'reaction.broadcast', ReactionBroadcastPayload>
  | WsEnvelope<'state.sync', StateSyncPayload>
  | WsEnvelope<'presence.update', PresenceUpdatePayload>
  // ✅ 공통
  | WsEnvelope<'error', ErrorPayload>
  // ⚠️ STUB (게임 도메인)
  | WsEnvelope<'round.start', RoundStartPayload>
  | WsEnvelope<'round.end', RoundEndPayload>
  | WsEnvelope<'dice.broadcast', DiceBroadcastPayload>
  | WsEnvelope<'dice.hold_changed', DiceHoldChangedPayload>
  | WsEnvelope<'score.update', ScoreUpdatePayload>
  | WsEnvelope<'game.over', GameOverPayload>
  | WsEnvelope<'state.patch', StatePatchPayload>

export type WsMessage = ClientMessage | ServerMessage

/** 각 방향의 type 문자열만 뽑은 유니온 (switch exhaustive 체크용) */
export type ClientMessageType = ClientMessage['type']
export type ServerMessageType = ServerMessage['type']

/* ============================================================================
 * 5. 헬퍼 (FE 편의용) — discriminated union 의 실익
 * ==========================================================================*/

/** 수신 메시지를 type 으로 좁혀 안전하게 분기. */
export function isServer<T extends ServerMessageType>(
  msg: ServerMessage,
  type: T,
): msg is Extract<ServerMessage, { type: T }> {
  return msg.type === type
}

/** 송신 메시지 빌더. ts 자동 세팅, type 에 맞는 payload 를 컴파일 타임에 강제. */
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
