import type {
  Player,
  RoomSnapshot,
  ScoreBoard,
  ServerMessage,
  YachtCategory,
} from '@/realtime/wsEvents'
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

export function createPlayingRoomSnapshot(roundDeadline: number): RoomSnapshot {
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

/** 테스트용 고정 스냅샷. 실행 중인 mock 서버는 아래 handler에서 현재 시각 기준 deadline을 준다. */
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

/**
 * 파티 모드 대시보드. 방을 열었지만 <b>플레이어가 아니다</b> — `you`가 참가자 목록에 없는 것이
 * 이 픽스처의 요점이다. 실서버도 대시보드를 플레이어 명단에 넣지 않는다(백엔드 `RoomMode.PARTY`).
 */
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
