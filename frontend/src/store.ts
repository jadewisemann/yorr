import { create } from 'zustand'
import {
  type AuthSession,
  clearAuthSession,
  readAuthSession,
  saveAuthSession,
} from '@/auth/authSession'
import type { GameCode } from '@/games'
import type { RoomSnapshot } from '@/realtime/wsEvents'
import type { RoomSession } from '@/room/api/roomApi'
import {
  type SessionEndReason,
  type SessionPhase,
  sessionEndNotices,
  sessionPhaseOf,
} from '@/room/domain/sessionFsm'
import { clearRoomSession, readRoomSession, saveRoomSession } from '@/room/roomSessionStorage'

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed'
export type RoomResumeReason = 'restored' | 'disconnected'

export type ActiveRoomSession = Omit<RoomSession, 'snapshot'>

export interface QuickMatchRequest {
  gameCode: GameCode
  nickname: string
}

interface AppState {
  appNotice: string | null
  authSession: AuthSession | null
  connectionStatus: ConnectionStatus
  quickMatch: QuickMatchRequest | null
  roomResumeReason: RoomResumeReason | null
  roomSession: ActiveRoomSession | null
  roomSnapshot: RoomSnapshot | null
  signIn: (session: AuthSession) => void
  signOut: () => void
  setAppNotice: (notice: string | null) => void
  setConnectionStatus: (status: ConnectionStatus) => void
  startQuickMatch: (request: QuickMatchRequest) => void
  stopQuickMatch: () => void
  setRoomSession: (session: RoomSession) => void
  resumeRoomSession: () => void
  replaceRoomSnapshot: (snapshot: RoomSnapshot | null) => void
  endSession: (reason: SessionEndReason) => void
  reset: () => void
}

export function selectSessionPhase(state: AppState): SessionPhase {
  return sessionPhaseOf(state.roomSession, state.roomSnapshot)
}

const restoredSession = readRoomSession()

const initialState = {
  appNotice: null,
  authSession: readAuthSession(),
  connectionStatus: 'idle' as const,
  quickMatch: null,
  roomResumeReason: restoredSession ? ('restored' as const) : null,
  roomSession: restoredSession ? withoutSnapshot(restoredSession) : null,
  roomSnapshot: restoredSession?.snapshot ?? null,
}

export const useAppStore = create<AppState>((set) => ({
  ...initialState,
  signIn: (session) => {
    saveAuthSession(session)
    set({ appNotice: null, authSession: session })
  },
  signOut: () => {
    clearAuthSession()
    set({ authSession: null })
  },
  setAppNotice: (appNotice) => set({ appNotice }),
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  startQuickMatch: (quickMatch) => set({ appNotice: null, quickMatch }),
  stopQuickMatch: () => set({ quickMatch: null }),
  setRoomSession: (session) => {
    saveRoomSession(session)
    set({
      appNotice: null,
      roomResumeReason: null,
      roomSession: withoutSnapshot(session),
      roomSnapshot: session.snapshot,
    })
  },
  resumeRoomSession: () => set({ appNotice: null, roomResumeReason: null }),
  replaceRoomSnapshot: (roomSnapshot) =>
    set((state) => {
      if (state.roomSession && roomSnapshot) {
        saveRoomSession({ ...state.roomSession, snapshot: roomSnapshot })
      }
      return { roomSnapshot }
    }),
  endSession: (reason) => {
    if (reason === 'disconnected') {
      set({
        appNotice: sessionEndNotices.disconnected,
        connectionStatus: 'closed',
        roomResumeReason: 'disconnected',
      })
      return
    }

    clearRoomSession()
    set({
      appNotice: sessionEndNotices[reason],
      connectionStatus: 'idle',
      quickMatch: null,
      roomResumeReason: null,
      roomSession: null,
      roomSnapshot: null,
    })
  },
  reset: () => {
    clearRoomSession()
    set({
      appNotice: null,
      connectionStatus: 'idle',
      quickMatch: null,
      roomResumeReason: null,
      roomSession: null,
      roomSnapshot: null,
    })
  },
}))

function withoutSnapshot({ snapshot: _snapshot, ...session }: RoomSession): ActiveRoomSession {
  return session
}
