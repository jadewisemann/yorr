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
export type RoomResumeReason = 'restored' | 'disconnected'

export type ActiveRoomSession = Omit<RoomSession, 'snapshot'>

interface AppState {
  appNotice: string | null
  connectionStatus: ConnectionStatus
  roomResumeReason: RoomResumeReason | null
  roomSession: ActiveRoomSession | null
  roomSnapshot: RoomSnapshot | null
  setAppNotice: (notice: string | null) => void
  setConnectionStatus: (status: ConnectionStatus) => void
  setRoomSession: (session: RoomSession) => void
  resumeRoomSession: () => void
  replaceRoomSnapshot: (snapshot: RoomSnapshot | null) => void
  /** 세션 FSM의 종료·복귀 대기 전이. 이유에 맞는 토큰 정책과 안내를 함께 처리한다. */
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
  roomResumeReason: restoredSession ? ('restored' as const) : null,
  roomSession: restoredSession ? withoutSnapshot(restoredSession) : null,
  roomSnapshot: restoredSession?.snapshot ?? null,
}

export const useAppStore = create<AppState>((set) => ({
  ...initialState,
  setAppNotice: (appNotice) => set({ appNotice }),
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
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
      roomResumeReason: null,
      roomSession: null,
      roomSnapshot: null,
    })
  },
}))

function withoutSnapshot({ snapshot: _snapshot, ...session }: RoomSession): ActiveRoomSession {
  return session
}
