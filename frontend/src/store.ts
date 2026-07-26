import { create } from 'zustand'
import type { RoomSession } from '@/api/gameApi'
import type { RoomSnapshot } from '@/realtime/wsEvents'
import { clearRoomSession, readRoomSession, saveRoomSession } from '@/roomSessionStorage'

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed'

export type ActiveRoomSession = Omit<RoomSession, 'snapshot'>

interface AppState {
  connectionStatus: ConnectionStatus
  roomSession: ActiveRoomSession | null
  roomSnapshot: RoomSnapshot | null
  setConnectionStatus: (status: ConnectionStatus) => void
  setRoomSession: (session: RoomSession) => void
  replaceRoomSnapshot: (snapshot: RoomSnapshot | null) => void
  reset: () => void
}

const restoredSession = readRoomSession()

const initialState = {
  connectionStatus: 'idle' as const,
  roomSession: restoredSession ? withoutSnapshot(restoredSession) : null,
  roomSnapshot: restoredSession?.snapshot ?? null,
}

export const useAppStore = create<AppState>((set) => ({
  ...initialState,
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  setRoomSession: (session) => {
    saveRoomSession(session)
    set({ roomSession: withoutSnapshot(session), roomSnapshot: session.snapshot })
  },
  replaceRoomSnapshot: (roomSnapshot) =>
    set((state) => {
      if (state.roomSession && roomSnapshot) {
        saveRoomSession({ ...state.roomSession, snapshot: roomSnapshot })
      }
      return { roomSnapshot }
    }),
  reset: () => {
    clearRoomSession()
    set({ connectionStatus: 'idle', roomSession: null, roomSnapshot: null })
  },
}))

function withoutSnapshot({ snapshot: _snapshot, ...session }: RoomSession): ActiveRoomSession {
  return session
}
