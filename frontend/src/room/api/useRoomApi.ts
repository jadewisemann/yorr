import type { GameCode } from '@/games'
import { useAsyncTask } from '@/shared/api/useAsyncTask'
import { useAppStore } from '@/store'
import type { CreateRoomRequest, JoinRoomRequest, RoomSession } from './roomApi'
import { roomApiClient } from './roomApi'

export function useCreateRoom() {
  const setRoomSession = useAppStore((state) => state.setRoomSession)

  return useAsyncTask<[CreateRoomRequest], RoomSession>(
    (signal, request) => roomApiClient.createRoom(request, { signal }),
    { onSuccess: setRoomSession },
  )
}

export function useCreatePartyRoom() {
  const setRoomSession = useAppStore((state) => state.setRoomSession)

  return useAsyncTask<[GameCode], RoomSession>(
    (signal, gameCode) => roomApiClient.createPartyRoom(gameCode, { signal }),
    { onSuccess: setRoomSession },
  )
}

export function useJoinRoom() {
  const setRoomSession = useAppStore((state) => state.setRoomSession)

  return useAsyncTask<[string, JoinRoomRequest], RoomSession>(
    (signal, roomId, request) => roomApiClient.joinRoom(roomId, request, { signal }),
    { onSuccess: setRoomSession },
  )
}

export function useLeaveSession() {
  const leaveRoom = useAsyncTask<[], void>(async (signal) => {
    const session = useAppStore.getState().roomSession
    if (!session) return
    await roomApiClient.leaveRoom(session.roomCode, {
      signal,
      sessionToken: session.sessionToken,
      userId: session.you,
    })
  })

  const leave = async () => {
    await leaveRoom.execute()
    useAppStore.getState().endSession('left')
  }

  return { isLeaving: leaveRoom.isLoading, leave }
}
