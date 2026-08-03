import { useAsyncTask } from '@/shared/api/useAsyncTask'
import { useAppStore } from '@/store'
import type { CreateRoomRequest, JoinRoomRequest, RoomSession } from './gameApi'
import { gameApiClient } from './gameApi'

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

/**
 * 퇴장 단일 경로. 서버에 나간다고 알린 뒤(FSM: any → idle) 로컬 세션을 정리한다.
 * REST가 실패해도 로컬은 반드시 정리한다 — 서버는 소켓 종료 시 스스로 명단을 정리하므로,
 * 요청 실패가 사용자를 방에 가두는 이유가 될 수 없다.
 */
export function useLeaveSession() {
  const leaveRoom = useAsyncTask<[], void>(async (signal) => {
    const session = useAppStore.getState().roomSession
    if (!session) return
    await gameApiClient.leaveRoom(session.roomCode, {
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
