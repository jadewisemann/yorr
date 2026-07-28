import type { PlayerId } from '@/realtime/wsEvents'
import { useAppStore } from '@/store'
import type { CreateRoomRequest, JoinRoomRequest, RoomSession } from './gameApi'
import { gameApiClient } from './gameApi'
import { useAsyncTask } from './useAsyncTask'

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

export function useLeaveRoom() {
  return useAsyncTask<[string, PlayerId, string], boolean>(
    (signal, roomCode, userId, sessionToken) =>
      gameApiClient
        .leaveRoom(roomCode, {
          signal,
          sessionToken,
          userId,
        })
        .then(() => true),
  )
}
