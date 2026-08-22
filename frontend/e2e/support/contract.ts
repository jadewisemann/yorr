export type RoomPhase = 'waiting' | 'playing' | 'finished'
export type PlayerStatus = 'online' | 'away' | 'offline'

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

export const MEMBER: Identity = {
  id: 'member-e2e',
  nickname: '카카오회원',
  token: 'session-member-e2e',
}

export const KAKAO_LOGIN_CODE = 'e2e-kakao-code'

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
  return { roomId, phase: 'waiting', players, hostId: HOST.id }
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
