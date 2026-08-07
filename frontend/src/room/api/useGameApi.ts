import type { PlayerId, RoomPhase, RoomSnapshot } from '@/realtime/wsEvents'
import { useAsyncTask, useFetchEffect } from '@/shared/api/useAsyncTask'
import { useAppStore } from '@/store'
import type { GameStartResult } from './roomApi'
import { roomApiClient } from './roomApi'

export function useGame(gameId: string | null) {
  const replaceRoomSnapshot = useAppStore((state) => state.replaceRoomSnapshot)

  return useFetchEffect<RoomSnapshot>(
    gameId ? `game:${gameId}` : null,
    (signal) => requireId(gameId, 'Game ID', (id) => roomApiClient.getGame(id, { signal })),
    {
      onSuccess: (snapshot) => {
        replaceRoomSnapshot(preserveRealtimeGame(snapshot))
      },
    },
  )
}

export function useStartGame() {
  const replaceRoomSnapshot = useAppStore((state) => state.replaceRoomSnapshot)
  const roomSession = useAppStore((state) => state.roomSession)
  const setRoomSession = useAppStore((state) => state.setRoomSession)

  return useAsyncTask<[], GameStartResult>(
    (signal) =>
      roomSession
        ? roomApiClient.startGame(roomSession.roomCode, {
            signal,
            sessionToken: roomSession.sessionToken,
            userId: roomSession.you,
          })
        : Promise.reject(new Error('Room session is required')),
    {
      onSuccess: (result) => {
        if (!roomSession) return
        const snapshot = preserveRealtimeGame(result.snapshot)
        setRoomSession({
          ...roomSession,
          gameId: result.gameId,
          snapshot,
        })
        replaceRoomSnapshot(snapshot)
      },
    },
  )
}

export function useAddBot() {
  const roomSession = useAppStore((state) => state.roomSession)
  const replaceRoomSnapshot = useAppStore((state) => state.replaceRoomSnapshot)

  return useAsyncTask<[], RoomSnapshot>(
    (signal) =>
      roomSession
        ? roomApiClient.addBot(roomSession.roomCode, {
            signal,
            sessionToken: roomSession.sessionToken,
            userId: roomSession.you,
          })
        : Promise.reject(new Error('Room session is required')),
    { onSuccess: replaceRoomSnapshot },
  )
}

export function useRemoveBot() {
  const roomSession = useAppStore((state) => state.roomSession)
  const replaceRoomSnapshot = useAppStore((state) => state.replaceRoomSnapshot)

  return useAsyncTask<[PlayerId], RoomSnapshot>(
    (signal, botId) =>
      roomSession
        ? roomApiClient.removeBot(roomSession.roomCode, botId, {
            signal,
            sessionToken: roomSession.sessionToken,
            userId: roomSession.you,
          })
        : Promise.reject(new Error('Room session is required')),
    { onSuccess: replaceRoomSnapshot },
  )
}

export function useReturnToLobby() {
  const roomSession = useAppStore((state) => state.roomSession)

  return useAsyncTask<[], void>((signal) =>
    roomSession
      ? roomApiClient.returnToLobby(roomSession.roomCode, {
          signal,
          sessionToken: roomSession.sessionToken,
          userId: roomSession.you,
        })
      : Promise.reject(new Error('Room session is required')),
  )
}

const phaseOrder: Record<RoomPhase, number> = { waiting: 0, playing: 1, finished: 2 }

function preserveRealtimeGame(snapshot: RoomSnapshot): RoomSnapshot {
  const current = useAppStore.getState().roomSnapshot
  const merged = current?.game ? { ...snapshot, game: current.game } : snapshot
  if (!current || phaseOrder[current.phase] <= phaseOrder[snapshot.phase]) return merged
  return current.phase === 'finished'
    ? { ...merged, phase: current.phase, players: current.players }
    : { ...merged, phase: current.phase }
}

function requireId<TData>(
  id: string | null,
  label: string,
  request: (id: string) => Promise<TData>,
): Promise<TData> {
  return id ? request(id) : Promise.reject(new Error(`${label} is required`))
}
