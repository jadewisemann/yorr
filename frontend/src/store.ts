import { create } from 'zustand'
import type { RoomSession } from '@/api/gameApi'
import type { RoomSnapshot } from '@/realtime/wsEvents'

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

const initialState = {
  connectionStatus: 'idle' as const,
  roomSession: null,
  roomSnapshot: null,
}

export const useAppStore = create<AppState>((set) => ({
  ...initialState,
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  setRoomSession: ({ snapshot: roomSnapshot, ...roomSession }) =>
    set({ roomSession, roomSnapshot }),
  replaceRoomSnapshot: (roomSnapshot) => set({ roomSnapshot }),
  reset: () => set(initialState),
}))
