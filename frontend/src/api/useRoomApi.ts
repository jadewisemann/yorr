import type { RoomSnapshot } from '@/realtime/wsEvents'
import { useAppStore } from '@/store'
import type { CreateRoomRequest, JoinRoomRequest, RoomSession } from './gameApi'
import { gameApiClient } from './gameApi'
import { useAsyncQuery, useAsyncTask } from './useAsyncTask'

export function useCreateRoom() {
  const setRoomSession = useAppStore((state) => state.setRoomSession)

  return useAsyncTask<[CreateRoomRequest], RoomSession>(
    (signal, request) => gameApiClient.createRoom(request, { signal }),
    { onSuccess: setRoomSession },
  )
}

export function useJoinRoom() {
  const setRoomSession = useAppStore((state) => state.setRoomSession)

  return useAsyncTask<[string, JoinRoomRequest], RoomSession>(
    (signal, roomId, request) => gameApiClient.joinRoom(roomId, request, { signal }),
    { onSuccess: setRoomSession },
  )
}

export function useLobby(roomId: string | null) {
  const replaceRoomSnapshot = useAppStore((state) => state.replaceRoomSnapshot)

  return useAsyncQuery<RoomSnapshot>(
    roomId ? `lobby:${roomId}` : null,
    (signal) => requireRoomId(roomId, (id) => gameApiClient.getLobby(id, { signal })),
    { onSuccess: replaceRoomSnapshot },
  )
}

function requireRoomId<TData>(
  roomId: string | null,
  request: (roomId: string) => Promise<TData>,
): Promise<TData> {
  return roomId ? request(roomId) : Promise.reject(new Error('Room ID is required'))
}
