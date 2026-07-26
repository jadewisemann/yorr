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

export const creatorPlayer: Player = {
  playerId: 'player-creator',
  nickname: '느긋한 주사위',
  status: 'online',
}

export const participantPlayer: Player = {
  playerId: 'player-participant',
  nickname: '참가자',
  status: 'online',
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
  players: [creatorPlayer, participantPlayer],
}

export const playingRoomSnapshot: RoomSnapshot = {
  ...waitingRoomSnapshot,
  phase: 'playing',
  game: {
    roundNumber: 1,
    roundDeadline: 1_753_000_060_000,
    scores: {
      [creatorPlayer.playerId]: createEmptyScoreBoard(),
      [participantPlayer.playerId]: createEmptyScoreBoard(),
    },
  },
}

export const creatorSession: RoomSession = {
  roomId: MOCK_ROOM_ID,
  roomCode: MOCK_ROOM_CODE,
  you: creatorPlayer.playerId,
  sessionToken: 'session-creator-64',
  snapshot: waitingRoomSnapshot,
}

export const participantSession: RoomSession = {
  roomId: MOCK_ROOM_ID,
  roomCode: MOCK_ROOM_CODE,
  you: participantPlayer.playerId,
  sessionToken: 'session-participant-64',
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
