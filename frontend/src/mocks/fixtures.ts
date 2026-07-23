import type { RoomSession, ScoreCandidates } from '@/api/gameApi'
import type {
  Player,
  RoomSnapshot,
  ScoreBoard,
  ServerMessage,
  YachtCategory,
} from '@/realtime/wsEvents'
import { YACHT_CATEGORIES } from '@/realtime/wsEvents'

export const MOCK_ROOM_ID = 'room-yorr-64'
export const MOCK_ROOM_CODE = 'YORR64'

export const hostPlayer: Player = {
  playerId: 'player-host',
  nickname: '방장',
  status: 'online',
  isHost: true,
}

export const guestPlayer: Player = {
  playerId: 'player-guest',
  nickname: '참가자',
  status: 'online',
  isHost: false,
}

export function createEmptyScoreBoard(): ScoreBoard {
  return {
    categories: Object.fromEntries(YACHT_CATEGORIES.map((category) => [category, null])) as Record<
      YachtCategory,
      null
    >,
    upperSubtotal: 0,
    upperBonus: 0,
    total: 0,
  }
}

export const waitingRoomSnapshot: RoomSnapshot = {
  roomId: MOCK_ROOM_ID,
  phase: 'waiting',
  hostId: hostPlayer.playerId,
  players: [hostPlayer, guestPlayer],
}

export const playingRoomSnapshot: RoomSnapshot = {
  ...waitingRoomSnapshot,
  phase: 'playing',
  game: {
    roundNumber: 1,
    roundDeadline: 1_753_000_060_000,
    scores: {
      [hostPlayer.playerId]: createEmptyScoreBoard(),
      [guestPlayer.playerId]: createEmptyScoreBoard(),
    },
  },
}

export const hostSession: RoomSession = {
  roomId: MOCK_ROOM_ID,
  roomCode: MOCK_ROOM_CODE,
  you: hostPlayer.playerId,
  sessionToken: 'session-host-64',
  snapshot: waitingRoomSnapshot,
}

export const guestSession: RoomSession = {
  roomId: MOCK_ROOM_ID,
  roomCode: MOCK_ROOM_CODE,
  you: guestPlayer.playerId,
  sessionToken: 'session-guest-64',
  snapshot: waitingRoomSnapshot,
}

export const scoreCandidates: ScoreCandidates = {
  candidates: {
    ones: 1,
    twos: 4,
    threes: 6,
    fours: 0,
    fives: 5,
    sixes: 0,
    choice: 16,
    fourOfAKind: 0,
    fullHouse: 0,
    smallStraight: 0,
    largeStraight: 0,
    yacht: 0,
  },
}

export function serverMessage<T extends ServerMessage['type']>(
  type: T,
  payload: Extract<ServerMessage, { type: T }>['payload'],
  options: {
    roomId?: string | undefined
    msgId?: string | undefined
    ts?: number | undefined
  } = {},
): Extract<ServerMessage, { type: T }> {
  return {
    type,
    ts: options.ts ?? 1_753_000_000_000,
    payload,
    ...(options.roomId === undefined ? {} : { roomId: options.roomId }),
    ...(options.msgId === undefined ? {} : { msgId: options.msgId }),
  } as Extract<ServerMessage, { type: T }>
}
