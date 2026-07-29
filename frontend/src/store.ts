import { create } from 'zustand'
import type { RoomSession } from '@/api/gameApi'
import type { RoomSnapshot } from '@/realtime/wsEvents'
import { clearRoomSession, readRoomSession, saveRoomSession } from '@/roomSessionStorage'
import {
  type SessionEndReason,
  type SessionPhase,
  sessionEndNotices,
  sessionPhaseOf,
} from '@/sessionFsm'

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
  /** 세션 FSM의 종료 전이(any → idle). 이유에 맞는 안내 문구까지 함께 처리한다. */
  endSession: (reason: SessionEndReason) => void
  reset: () => void
}

/** 세션 FSM의 현재 상태. 구독 컴포넌트는 이 selector 하나만 보면 된다. */
export function selectSessionPhase(state: AppState): SessionPhase {
  return sessionPhaseOf(state.roomSession, state.roomSnapshot)
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
  endSession: (reason) => {
    clearRoomSession()
    set({
      appNotice: sessionEndNotices[reason],
      connectionStatus: 'idle',
      roomSession: null,
      roomSnapshot: null,
    })
  },
  reset: () => {
    clearRoomSession()
    set({ appNotice: null, connectionStatus: 'idle', roomSession: null, roomSnapshot: null })
  },
}))

function withoutSnapshot({ snapshot: _snapshot, ...session }: RoomSession): ActiveRoomSession {
  return session
}
