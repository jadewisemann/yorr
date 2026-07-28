import type { RoomSnapshot } from '@/realtime/wsEvents'
import { useAppStore } from '@/store'
import type { GameStartResult, ScoreCandidates, ScoreCandidatesRequest } from './gameApi'
import { gameApiClient } from './gameApi'
import { useAsyncQuery, useAsyncTask } from './useAsyncTask'

export function useGame(gameId: string | null) {
  const replaceRoomSnapshot = useAppStore((state) => state.replaceRoomSnapshot)

  return useAsyncQuery<RoomSnapshot>(
    gameId ? `game:${gameId}` : null,
    (signal) => requireId(gameId, 'Game ID', (id) => gameApiClient.getGame(id, { signal })),
    { onSuccess: replaceRoomSnapshot },
  )
}

export function useStartGame() {
  const replaceRoomSnapshot = useAppStore((state) => state.replaceRoomSnapshot)
  const roomSession = useAppStore((state) => state.roomSession)
  const setRoomSession = useAppStore((state) => state.setRoomSession)

  return useAsyncTask<[], GameStartResult>(
    (signal) =>
      roomSession
        ? gameApiClient.startGame(roomSession.roomCode, {
            signal,
            sessionToken: roomSession.sessionToken,
            userId: roomSession.you,
          })
        : Promise.reject(new Error('Room session is required')),
    {
      onSuccess: (result) => {
        if (!roomSession) return
        setRoomSession({
          ...roomSession,
          gameId: result.gameId,
          snapshot: result.snapshot,
        })
        replaceRoomSnapshot(result.snapshot)
      },
    },
  )
}

export function useScoreCandidates() {
  return useAsyncTask<[string, ScoreCandidatesRequest], ScoreCandidates>(
    (signal, gameId, request) => gameApiClient.getScoreCandidates(gameId, request, { signal }),
  )
}

function requireId<TData>(
  id: string | null,
  label: string,
  request: (id: string) => Promise<TData>,
): Promise<TData> {
  return id ? request(id) : Promise.reject(new Error(`${label} is required`))
}
