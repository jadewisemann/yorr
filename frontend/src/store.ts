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
import {
  applyTheme,
  type ResolvedTheme,
  readThemePreference,
  resolveTheme,
  saveThemePreference,
  type ThemePreference,
} from '@/styles/theme'

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
  themePreference: ThemePreference
  /**
   * 실제로 적용된 테마. `themePreference`가 `system`일 때 OS 설정을 따라가므로 선택만으로는
   * 알 수 없고, 그 값을 보고 그리는 UI(테마 토글의 아이콘)가 있어서 상태로 들고 있다.
   * 갱신은 `setThemePreference`와 `useThemeSync`(OS 변화 감시) 두 곳뿐이다.
   */
  resolvedTheme: ResolvedTheme
  signIn: (session: AuthSession) => void
  signOut: () => void
  setAppNotice: (notice: string | null) => void
  setConnectionStatus: (status: ConnectionStatus) => void
  startQuickMatch: (request: QuickMatchRequest) => void
  stopQuickMatch: () => void
  setRoomSession: (session: RoomSession) => void
  resumeRoomSession: () => void
  replaceRoomSnapshot: (snapshot: RoomSnapshot | null) => void
  setThemePreference: (preference: ThemePreference) => void
  setResolvedTheme: (theme: ResolvedTheme) => void
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
  themePreference: readThemePreference(),
  resolvedTheme: resolveTheme(readThemePreference()),
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
  // 영속·DOM 반영은 액션의 부수효과다(DESIGN.md 원칙 3) — 구독자가 useEffect로
  // 뒤따라 적용하면 첫 프레임이 옛 테마로 그려진다.
  setThemePreference: (themePreference) => {
    const resolvedTheme = resolveTheme(themePreference)
    saveThemePreference(themePreference)
    applyTheme(resolvedTheme)
    set({ resolvedTheme, themePreference })
  },
  setResolvedTheme: (resolvedTheme) => set({ resolvedTheme }),
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
