import { create } from 'zustand'
import type { RoomSession } from '@/api/gameApi'
import type { RoomSnapshot } from '@/realtime/wsEvents'
import { clearRoomSession, readRoomSession, saveRoomSession } from '@/roomSessionStorage'

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed'

export type ActiveRoomSession = Omit<RoomSession, 'snapshot'>

interface AppState {
  appNotice: string | null
  connectionStatus: ConnectionStatus
  roomSession: ActiveRoomSession | null
  roomSnapshot: RoomSnapshot | null
  setAppNotice: (notice: string | null) => void
  setConnectionStatus: (status: ConnectionStatus) => void
  setRoomSession: (session: RoomSession) => void
  replaceRoomSnapshot: (snapshot: RoomSnapshot | null) => void
  reset: () => void
}

const restoredSession = readRoomSession()

const initialState = {
  appNotice: null,
  connectionStatus: 'idle' as const,
  roomSession: restoredSession ? withoutSnapshot(restoredSession) : null,
  roomSnapshot: restoredSession?.snapshot ?? null,
}

export const useAppStore = create<AppState>((set) => ({
  ...initialState,
  setAppNotice: (appNotice) => set({ appNotice }),
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
    set({ appNotice: null, connectionStatus: 'idle', roomSession: null, roomSnapshot: null })
  },
}))

function withoutSnapshot({ snapshot: _snapshot, ...session }: RoomSession): ActiveRoomSession {
  return session
}
