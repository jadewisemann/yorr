import { create } from 'zustand'
import type { RoomSnapshot } from '../contracts/ws-events'

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed'

interface AppState {
  connectionStatus: ConnectionStatus
  roomSnapshot: RoomSnapshot | null
  setConnectionStatus: (status: ConnectionStatus) => void
  replaceRoomSnapshot: (snapshot: RoomSnapshot | null) => void
  reset: () => void
}

const initialState = {
  connectionStatus: 'idle' as const,
  roomSnapshot: null,
}

export const useAppStore = create<AppState>((set) => ({
  ...initialState,
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  replaceRoomSnapshot: (roomSnapshot) => set({ roomSnapshot }),
  reset: () => set(initialState),
}))
