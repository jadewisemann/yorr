import type { useNavigate } from '@tanstack/react-router'
import { closeSession } from '@/auth/api/authApi'
import type { AuthSession } from '@/auth/authSession'
import { type GameKey, gameAt } from '@/games'
import { normalizeRoomCode } from '@/room/domain/roomCode'
import { playLandingSoundtrack } from '@/shared/audio/soundtrack'
import type { useAppStore } from '@/store'

type Navigate = ReturnType<typeof useNavigate>
type SetNotice = ReturnType<typeof useAppStore.getState>['setAppNotice']

interface EntryNavigationOptions {
  activeIndex: number
  code: string
  navigate: Navigate
  setActiveIndex: (index: number) => void
  setCodeOpen: (open: boolean) => void
  setPlayModeOpen: (open: boolean) => void
  setAccountOpen: (open: boolean) => void
}

/**
 * 랜딩 화면의 이동 동작 — 게임 선택·플레이 모드별 분기·방 코드 입장.
 * 다이얼로그를 닫는 것까지가 한 동작이라 함께 둔다(열고 닫는 상태는 화면이 가진다).
 */
export function useEntryNavigation(options: EntryNavigationOptions) {
  const { activeIndex, code, navigate, setActiveIndex, setCodeOpen, setPlayModeOpen } = options
  const { setAccountOpen } = options
  const key = () => gameAt(activeIndex).key
  const closePlayMode = () => setPlayModeOpen(false)

  const handleGameSelect = (index: number) => {
    const next = gameAt(index)
    playLandingSoundtrack(next.key)
    setActiveIndex(index)
    openGameHome(navigate, next.key)
  }

  const handleCreateRoom = () => {
    closePlayMode()
    if (key() === 'pingpong') openParty(navigate, 'pingpong')
    else openJoin(navigate, { game: key() })
  }

  const handleQuickMatch = () => {
    closePlayMode()
    openJoin(navigate, { game: key(), mode: 'quick' })
  }

  const handleTutorial = () => {
    closePlayMode()
    void navigate({ to: '/tutorial' })
  }

  const handleAiMatch = () => {
    closePlayMode()
    void navigate({ to: '/pingpong' })
  }

  const handlePartyMode = () => {
    closePlayMode()
    openParty(navigate, key())
  }

  const handleJoin = () => {
    setCodeOpen(false)
    openJoin(navigate, { code: normalizeRoomCode(code) })
  }

  const handleSignInRequest = () => {
    closePlayMode()
    setAccountOpen(true)
  }

  return {
    handleAiMatch,
    handleCreateRoom,
    handleGameSelect,
    handleJoin,
    handlePartyMode,
    handleQuickMatch,
    handleSignInRequest,
    handleTutorial,
  }
}

interface AccountActionsOptions {
  authSession: AuthSession | null
  setAccountOpen: (open: boolean) => void
  setAppNotice: SetNotice
  signOut: () => void
}

/** 로그아웃 — 서버 세션을 닫고 로컬 상태를 비운다(서버 실패는 무시한다). */
export function useAccountActions(options: AccountActionsOptions) {
  const { authSession, setAccountOpen, setAppNotice, signOut } = options
  return () => {
    setAccountOpen(false)
    if (authSession) void closeSession(authSession.sessionToken).catch(() => {})
    signOut()
    setAppNotice('로그아웃했어요.')
  }
}

// 라우트 인자 모양은 라우터가 정한다 — 화면 코드에 객체 리터럴이 쌓이지 않게 한 자리에 둔다.
function openGameHome(navigate: Navigate, game: GameKey) {
  void navigate({ to: '/', search: { game }, replace: true, viewTransition: false })
}

function openParty(navigate: Navigate, game: GameKey) {
  void navigate({ to: '/party', search: { game } })
}

type JoinSearch = {
  code: string | undefined
  game: GameKey | undefined
  mode?: 'quick'
}

function openJoin(navigate: Navigate, options: { code?: string; game?: GameKey; mode?: 'quick' }) {
  const search: JoinSearch = { code: options.code, game: options.game }
  if (options.mode) search.mode = options.mode
  void navigate({ to: '/join', search })
}
