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
        ? gameApiClient.startGame(roomSession.roomCode, {
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

/**
 * 대기실로 돌아가기. 화면 전환은 서버가 보내는 state.sync(phase=waiting)가 담당한다 —
 * 여기서 스냅샷을 직접 갈아끼우면 나만 먼저 옮겨가 다른 참가자와 상태가 갈린다.
 */
export function useReturnToLobby() {
  const roomSession = useAppStore((state) => state.roomSession)

  return useAsyncTask<[], void>((signal) =>
    roomSession
      ? gameApiClient.returnToLobby(roomSession.roomCode, {
          signal,
          sessionToken: roomSession.sessionToken,
          userId: roomSession.you,
        })
      : Promise.reject(new Error('Room session is required')),
  )
}

export function useScoreCandidates() {
  return useAsyncTask<[string, ScoreCandidatesRequest], ScoreCandidates>(
    (signal, gameId, request) => gameApiClient.getScoreCandidates(gameId, request, { signal }),
  )
}

function preserveRealtimeGame(snapshot: RoomSnapshot): RoomSnapshot {
  const realtimeGame = useAppStore.getState().roomSnapshot?.game
  return realtimeGame ? { ...snapshot, game: realtimeGame } : snapshot
}

function requireId<TData>(
  id: string | null,
  label: string,
  request: (id: string) => Promise<TData>,
): Promise<TData> {
  return id ? request(id) : Promise.reject(new Error(`${label} is required`))
}
