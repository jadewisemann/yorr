/**
 * src/realtime/wsEvents.ts 계약의 최소 미러.
 *
 * e2e는 tsconfig에 포함되지 않고 `@/` 별칭도 해석되지 않는다(wsEvents는 `@/domain/*`을 import한다).
 * 그래서 src를 직접 끌어오는 대신 테스트가 실제로 쓰는 필드만 여기에 옮겨 둔다.
 * 계약이 바뀌면 이 파일이 먼저 깨지도록 이름·형태를 원본과 똑같이 유지한다.
 */

export type RoomPhase = 'waiting' | 'playing' | 'finished'
export type PlayerStatus = 'online' | 'away' | 'offline'
/** REST 스냅샷은 phase를 대문자로 쓴다(src/api/gameApi.ts의 toRoomPhase). */
export type RestRoomPhase = 'LOBBY' | 'PLAYING' | 'FINISHED'

export interface Player {
  playerId: string
  nickname: string
  status: PlayerStatus
}

export const YACHT_CATEGORIES = [
  'ones',
  'twos',
  'threes',
  'fours',
  'fives',
  'sixes',
  'choice',
  'fourOfAKind',
  'fullHouse',
  'smallStraight',
  'largeStraight',
  'yacht',
] as const

export type YachtCategory = (typeof YACHT_CATEGORIES)[number]

const UPPER_CATEGORIES: readonly YachtCategory[] = [
  'ones',
  'twos',
  'threes',
  'fours',
  'fives',
  'sixes',
]
const UPPER_BONUS_THRESHOLD = 63
const UPPER_BONUS_POINTS = 35

export interface ScoreBoard {
  categories: Record<YachtCategory, number | null>
  upperSubtotal: number
  upperBonus: number
  total: number
}

export interface Ranking {
  rank: number
  playerId: string
  total: number
}

export interface GameState {
  roundNumber: number
  activePlayerId: string
  roundDeadline: number
  scores: Record<string, ScoreBoard>
  turnOrder?: string[]
  rankings?: Ranking[]
}

export interface RoomSnapshot {
  roomId: string
  phase: RoomPhase
  players: Player[]
  game?: GameState
}

export type DiceValue = 1 | 2 | 3 | 4 | 5 | 6
export type DiceSet = [DiceValue, DiceValue, DiceValue, DiceValue, DiceValue]
export type HeldDice = [boolean, boolean, boolean, boolean, boolean]

export interface Identity {
  id: string
  nickname: string
  token: string
}

export const ROOM_CODE = 'YORR64'
export const GAME_ID = 'game-1'

export const HOST: Identity = {
  id: 'player-host',
  nickname: '느긋한 주사위',
  token: 'session-host-64',
}

export const GUEST: Identity = {
  id: 'player-guest',
  nickname: '재빠른 문어',
  token: 'session-guest-64',
}

export const THIRD: Identity = {
  id: 'player-third',
  nickname: '졸린 갈매기',
  token: 'session-third-64',
}

/** 카카오 로그인 mock의 기본 회원 신원. `token`은 로그인 세션 토큰 자리에 그대로 쓴다. */
export const MEMBER: Identity = {
  id: 'member-e2e',
  nickname: '카카오회원',
  token: 'session-member-e2e',
}

/** authorize → callback 왕복에서 쓰는 일회용 코드. 실제 카카오 화면은 거치지 않고 그 결과만 흉내낸다. */
export const KAKAO_LOGIN_CODE = 'e2e-kakao-code'

/**
 * 라운드 마감은 테스트가 끝날 때까지 절대 지나지 않을 만큼 넉넉하게 준다.
 * 마감이 지나면 서버가 자동 굴림·자동 기록을 하는 경로가 열려 화면이 흔들린다.
 */
export const ROUND_DURATION_MS = 10 * 60 * 1000

export function roundDeadline() {
  return Date.now() + ROUND_DURATION_MS
}

export function player(identity: Identity, status: PlayerStatus = 'online'): Player {
  return { playerId: identity.id, nickname: identity.nickname, status }
}

export function emptyScoreBoard(): ScoreBoard {
  return scoreBoard({})
}

/** 서버가 파생값까지 계산해 내려주는 계약이라, 소계·보너스·총점을 여기서 채워 둔다. */
export function scoreBoard(recorded: Partial<Record<YachtCategory, number>>): ScoreBoard {
  const categories = Object.fromEntries(
    YACHT_CATEGORIES.map((category) => [category, recorded[category] ?? null]),
  ) as Record<YachtCategory, number | null>

  const upperSubtotal = UPPER_CATEGORIES.reduce(
    (subtotal, category) => subtotal + (recorded[category] ?? 0),
    0,
  )
  const upperBonus = upperSubtotal >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS_POINTS : 0
  const lowerSubtotal = YACHT_CATEGORIES.filter(
    (category) => !UPPER_CATEGORIES.includes(category),
  ).reduce((subtotal, category) => subtotal + (recorded[category] ?? 0), 0)

  return {
    categories,
    upperSubtotal,
    upperBonus,
    total: upperSubtotal + upperBonus + lowerSubtotal,
  }
}

export function waitingSnapshot(players: Player[], roomId = ROOM_CODE): RoomSnapshot {
  return { roomId, phase: 'waiting', players }
}

export function playingSnapshot(options: {
  players: Player[]
  activePlayerId: string
  roomId?: string
  roundNumber?: number
  deadline?: number
  scores?: Record<string, ScoreBoard>
  turnOrder?: string[]
}): RoomSnapshot {
  const players = options.players
  return {
    roomId: options.roomId ?? ROOM_CODE,
    phase: 'playing',
    players,
    game: {
      roundNumber: options.roundNumber ?? 1,
      activePlayerId: options.activePlayerId,
      roundDeadline: options.deadline ?? roundDeadline(),
      scores:
        options.scores ??
        Object.fromEntries(players.map((entry) => [entry.playerId, emptyScoreBoard()])),
      turnOrder: options.turnOrder ?? players.map((entry) => entry.playerId),
    },
  }
}

/**
 * REST 응답용 스냅샷. WS 스냅샷과 필드 이름이 다르다(roomCode·대문자 phase·players[].score).
 * 여기서 형태가 어긋나면 gameApi의 toRoomSnapshot이 던지므로 계약 회귀가 바로 드러난다.
 */
export function restSnapshot(options: {
  phase: RestRoomPhase
  players: Player[]
  roomCode?: string
  gameId?: string | null
  hostId?: string
  game?: GameState | null
}): Record<string, unknown> {
  return {
    roomCode: options.roomCode ?? ROOM_CODE,
    gameId: options.gameId ?? null,
    hostId: options.hostId ?? HOST.id,
    phase: options.phase,
    capacity: 6,
    players: options.players.map((entry) => ({
      playerId: entry.playerId,
      nickname: entry.nickname,
      score: 0,
    })),
    game: options.game ?? null,
  }
}
