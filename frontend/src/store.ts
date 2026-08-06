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

/**
 * 빠른 대전 대기 요청. 매칭을 기다리는 동안 <b>화면이 바뀌므로</b>(닉네임 → 대기실) 화면
 * 상태로는 들고 있을 수 없다 — polling과 백드롭을 맡은 `QuickMatchOverlay`가 이 값을 본다.
 * 닉네임은 방에서 쓸 이름이다(빠른 대전 API는 이름을 받지 않고, WS room.join이 보낸다).
 */
export interface QuickMatchRequest {
  gameCode: GameCode
  nickname: string
}

interface AppState {
  appNotice: string | null
  /** 로그인 세션. 방 세션과 수명이 달라 따로 둔다 — 방을 나가도 로그인은 남는다. */
  authSession: AuthSession | null
  connectionStatus: ConnectionStatus
  /** 빠른 대전 대기 중인가. null이면 대기 중이 아니다(백드롭도 서지 않는다). */
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
    // 방 세션은 건드리지 않는다 — 로그아웃했다고 진행 중인 게임에서 쫓아낼 이유가 없다.
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
      // 방을 떠났으면 매칭 대기도 끝이다 — 남겨두면 백드롭이 랜딩까지 따라온다.
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
