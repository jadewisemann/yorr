import type { Player, RoomSnapshot, ScoreBoard, YachtCategory } from '@/realtime/wsEvents'
import { YACHT_CATEGORIES } from '@/realtime/wsEvents'
import type { RoomSession } from '@/room/api/roomApi'

export const MOCK_ROOM_ID = 'YORR64'
export const MOCK_ROOM_CODE = 'YORR64'

export const creatorPlayer: Player = {
  playerId: 'player-creator',
  nickname: '느긋한 주사위',
  status: 'online',
  kind: 'HUMAN',
  isHost: true,
}

export const participantPlayer: Player = {
  playerId: 'player-participant',
  nickname: '참가자',
  status: 'online',
  kind: 'HUMAN',
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
  hostId: creatorPlayer.playerId,
  capacity: 6,
  players: [creatorPlayer, participantPlayer],
}

export const MOCK_ROUND_DURATION_MS = 30_000

/** `roundDeadline`이 null이면 제한 시간이 없는 판(봇만 있는 연습 방)이다. */
export function createPlayingRoomSnapshot(roundDeadline: number | null): RoomSnapshot {
  return {
    ...waitingRoomSnapshot,
    phase: 'playing',
    game: {
      activePlayerId: creatorPlayer.playerId,
      roundNumber: 1,
      roundDeadline,
      rollCount: 0,
      turnOrder: [creatorPlayer.playerId, participantPlayer.playerId],
      scores: {
        [creatorPlayer.playerId]: createEmptyScoreBoard(),
        [participantPlayer.playerId]: createEmptyScoreBoard(),
      },
    },
  }
}

export const playingRoomSnapshot: RoomSnapshot = createPlayingRoomSnapshot(1_753_000_060_000)

export const creatorSession = {
  gameId: null,
  roomId: MOCK_ROOM_ID,
  roomCode: MOCK_ROOM_CODE,
  you: creatorPlayer.playerId,
  nickname: creatorPlayer.nickname,
  membershipRole: 'host',
  sessionToken: 'session-creator-64',
  snapshot: waitingRoomSnapshot,
} satisfies RoomSession

export const participantSession = {
  gameId: null,
  roomId: MOCK_ROOM_ID,
  roomCode: MOCK_ROOM_CODE,
  you: participantPlayer.playerId,
  nickname: participantPlayer.nickname,
  membershipRole: 'participant',
  sessionToken: 'session-participant-64',
  snapshot: waitingRoomSnapshot,
} satisfies RoomSession

export const dashboardSession = {
  gameId: null,
  roomId: MOCK_ROOM_ID,
  roomCode: MOCK_ROOM_CODE,
  you: 'dashboard-64',
  nickname: '대시보드',
  membershipRole: 'dashboard',
  sessionToken: 'session-dashboard-64',
  snapshot: waitingRoomSnapshot,
} satisfies RoomSession

export { buildServerMessage as serverMessage } from '@/realtime/wsEvents'
