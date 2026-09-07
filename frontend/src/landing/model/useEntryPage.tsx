import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { closeSession } from '@/auth/api/authApi'
import { AccountDialog } from '@/auth/components/AccountDialog'
import { type GameKey, gameAt, gameIndexOf } from '@/games'
import { LandingCodeDialog } from '@/landing/components/LandingCodeDialog'
import { PlayModeDialog } from '@/landing/components/PlayModeDialog'
import { normalizeRoomCode } from '@/room/domain/roomCode'
import { readSoundMuted, saveSoundMuted } from '@/shared/audio/soundPreference'
import { playLandingSoundtrack, setSoundtrackMuted } from '@/shared/audio/soundtrack'
import { useMediaQuery } from '@/shared/useMediaQuery'
import { useAppStore } from '@/store'

const WIDE_LAYOUT = '(min-width: 760px)'

export function useEntryPage(gameKey: GameKey | undefined) {
  const navigate = useNavigate()
  const wide = useMediaQuery(WIDE_LAYOUT)
  const [activeIndex, setActiveIndex] = useState(() => gameIndexOf(gameKey))
  const [code, setCode] = useState('')
  const [codeOpen, setCodeOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [playModeOpen, setPlayModeOpen] = useState(false)
  const codeEntryRef = useRef<HTMLButtonElement>(null)
  const appNotice = useAppStore((state) => state.appNotice)
  const authSession = useAppStore((state) => state.authSession)
  const roomSession = useAppStore((state) => state.roomSession)
  const signOut = useAppStore((state) => state.signOut)
  const setAppNotice = useAppStore((state) => state.setAppNotice)

  const [soundMuted, setSoundMuted] = useState(readSoundMuted)

  const game = gameAt(activeIndex)
  const hasFooter = roomSession !== null || Boolean(appNotice)

  useEffect(() => {
    playLandingSoundtrack(game.key)
  }, [game.key])

  const toggleSound = () => {
    const muted = !soundMuted
    setSoundMuted(muted)
    saveSoundMuted(muted)
    setSoundtrackMuted(muted)
  }

  const handleGameSelect = (index: number) => {
    const { key } = gameAt(index)
    playLandingSoundtrack(key)
    setActiveIndex(index)
    void navigate({ to: '/', search: { game: key }, replace: true, viewTransition: false })
  }

  const handlePlay = () => setPlayModeOpen(true)

  const handleCreateRoom = () => {
    setPlayModeOpen(false)
    if (game.key === 'pingpong') {
      void navigate({ to: '/party', search: { game: 'pingpong' } })
      return
    }
    void navigate({ to: '/join', search: { code: undefined, game: game.key } })
  }

  const handleQuickMatch = () => {
    setPlayModeOpen(false)
    void navigate({ to: '/join', search: { code: undefined, game: game.key, mode: 'quick' } })
  }

  const handleTutorial = () => {
    setPlayModeOpen(false)
    void navigate({ to: '/tutorial' })
  }

  const handleAiMatch = () => {
    setPlayModeOpen(false)
    void navigate({ to: '/pingpong' })
  }

  const handlePartyMode = () => {
    setPlayModeOpen(false)
    void navigate({
      to: '/party',
      search: { game: game.key },
    })
  }

  const handleJoin = () => {
    setCodeOpen(false)
    void navigate({ to: '/join', search: { code: normalizeRoomCode(code), game: undefined } })
  }

  const handleSignOut = () => {
    setAccountOpen(false)
    if (authSession) void closeSession(authSession.sessionToken).catch(() => {})
    signOut()
    setAppNotice('로그아웃했어요.')
  }

  const codeDialog = (
    <LandingCodeDialog
      anchorRef={wide ? undefined : codeEntryRef}
      code={code}
      layout={wide ? 'wide' : 'narrow'}
      onClose={() => setCodeOpen(false)}
      onCodeChange={setCode}
      onSubmit={handleJoin}
      open={codeOpen}
    />
  )
  const accountDialog = (
    <AccountDialog
      layout={wide ? 'wide' : 'narrow'}
      onClose={() => setAccountOpen(false)}
      onSignOut={handleSignOut}
      open={accountOpen}
      session={authSession}
    />
  )
  const playModeDialog = (
    <PlayModeDialog
      game={game}
      onAiMatch={handleAiMatch}
      onClose={() => setPlayModeOpen(false)}
      onCreateRoom={handleCreateRoom}
      onPartyMode={handlePartyMode}
      onQuickMatch={handleQuickMatch}
      onSignIn={() => {
        setPlayModeOpen(false)
        setAccountOpen(true)
      }}
      onTutorial={handleTutorial}
      open={playModeOpen}
      signedIn={authSession !== null}
    />
  )

  return {
    accountOpen,
    activeIndex,
    setAccountOpen,
    setCodeOpen,
    soundMuted,
    accountDialog,
    appNotice,
    authSession,
    codeDialog,
    codeEntryRef,
    game,
    handleAiMatch,
    handleCreateRoom,
    handleGameSelect,
    handleJoin,
    handlePartyMode,
    handlePlay,
    handleQuickMatch,
    handleSignOut,
    handleTutorial,
    hasFooter,
    navigate,
    playModeDialog,
    roomSession,
    setAppNotice,
    signOut,
    toggleSound,
    wide,
  }
}
