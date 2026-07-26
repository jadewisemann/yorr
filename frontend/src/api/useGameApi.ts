import type { PlayerId, RoomSnapshot, ScoreBoard } from '@/realtime/wsEvents'
import { useAppStore } from '@/store'
import type { ScoreCandidates, SubmitRollRequest, SubmitScoreRequest } from './gameApi'
import { gameApiClient } from './gameApi'
import { useAsyncQuery, useAsyncTask } from './useAsyncTask'

export function useGame(roomId: string | null) {
  const replaceRoomSnapshot = useAppStore((state) => state.replaceRoomSnapshot)

  return useAsyncQuery<RoomSnapshot>(
    roomId ? `game:${roomId}` : null,
    (signal) => requireRoomId(roomId, (id) => gameApiClient.getGame(id, { signal })),
    { onSuccess: replaceRoomSnapshot },
  )
}

export function useStartGame() {
  const replaceRoomSnapshot = useAppStore((state) => state.replaceRoomSnapshot)

  return useAsyncTask<[string], RoomSnapshot>(
    (signal, roomId) => gameApiClient.startGame(roomId, { signal }),
    { onSuccess: replaceRoomSnapshot },
  )
}

export function useSubmitRoll() {
  const replaceRoomSnapshot = useAppStore((state) => state.replaceRoomSnapshot)

  return useAsyncTask<[string, SubmitRollRequest], RoomSnapshot>(
    (signal, roomId, request) => gameApiClient.submitRoll(roomId, request, { signal }),
    { onSuccess: replaceRoomSnapshot },
  )
}

export function useScoreCandidates(roomId: string | null) {
  return useAsyncQuery<ScoreCandidates>(roomId ? `score-candidates:${roomId}` : null, (signal) =>
    requireRoomId(roomId, (id) => gameApiClient.getScoreCandidates(id, { signal })),
  )
}

export function useSubmitScore() {
  return useAsyncTask<[string, SubmitScoreRequest], ScoreBoard>((signal, roomId, request) =>
    gameApiClient.submitScore(roomId, request, { signal }),
  )
}

export function useScoreboard(roomId: string | null) {
  return useAsyncQuery<Record<PlayerId, ScoreBoard>>(
    roomId ? `scoreboard:${roomId}` : null,
    (signal) => requireRoomId(roomId, (id) => gameApiClient.getScoreboard(id, { signal })),
  )
}

function requireRoomId<TData>(
  roomId: string | null,
  request: (roomId: string) => Promise<TData>,
): Promise<TData> {
  return roomId ? request(roomId) : Promise.reject(new Error('Room ID is required'))
}
