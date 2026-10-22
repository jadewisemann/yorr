import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { AccountDialog } from '@/auth/components/AccountDialog'
import { type GameKey, gameAt, gameIndexOf } from '@/games'
import { LandingCodeDialog } from '@/landing/components/LandingCodeDialog'
import { PlayModeDialog } from '@/landing/components/PlayModeDialog'
import { SupportDialog } from '@/landing/components/SupportDialog'
import { readSoundMuted, saveSoundMuted } from '@/shared/audio/soundPreference'
import { playLandingSoundtrack, setSoundtrackMuted } from '@/shared/audio/soundtrack'
import { useMediaQuery } from '@/shared/useMediaQuery'
import { useAppStore } from '@/store'
import { useAccountActions, useEntryNavigation } from './useEntryNavigation'

const WIDE_LAYOUT = '(min-width: 760px)'

/** 랜딩 화면의 상태·다이얼로그·동작을 한 묶음으로. 동작은 `useEntryActions`에 있다. */
export function useEntryPage(gameKey: GameKey | undefined) {
  const navigate = useNavigate()
  const wide = useMediaQuery(WIDE_LAYOUT)
  const [activeIndex, setActiveIndex] = useState(() => gameIndexOf(gameKey))
  const [code, setCode] = useState('')
  const [codeOpen, setCodeOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [playModeOpen, setPlayModeOpen] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const codeEntryRef = useRef<HTMLButtonElement>(null)
  const appNotice = useAppStore((state) => state.appNotice)
  const authSession = useAppStore((state) => state.authSession)
  const roomSession = useAppStore((state) => state.roomSession)
  const signOut = useAppStore((state) => state.signOut)
  const setAppNotice = useAppStore((state) => state.setAppNotice)

  const [soundMuted, setSoundMuted] = useState(readSoundMuted)

  const game = gameAt(activeIndex)
  const hasFooter = roomSession !== null || Boolean(appNotice)
  const layout = wide ? 'wide' : 'narrow'

  const actions = useEntryNavigation({
    activeIndex,
    code,
    navigate,
    setAccountOpen,
    setActiveIndex,
    setCodeOpen,
    setPlayModeOpen,
  })
  const handleSignOut = useAccountActions({ authSession, setAccountOpen, setAppNotice, signOut })

  useEffect(() => {
    playLandingSoundtrack(game.key)
  }, [game.key])

  const toggleSound = () => {
    const muted = !soundMuted
    setSoundMuted(muted)
    saveSoundMuted(muted)
    setSoundtrackMuted(muted)
  }

  const handlePlay = () => setPlayModeOpen(true)

  const codeDialog = (
    <LandingCodeDialog
      anchorRef={wide ? undefined : codeEntryRef}
      code={code}
      layout={layout}
      onClose={() => setCodeOpen(false)}
      onCodeChange={setCode}
      onSubmit={actions.handleJoin}
      open={codeOpen}
    />
  )
  const accountDialog = (
    <AccountDialog
      layout={layout}
      onClose={() => setAccountOpen(false)}
      onSignOut={handleSignOut}
      open={accountOpen}
      session={authSession}
    />
  )
  const playModeDialog = (
    <PlayModeDialog
      game={game}
      onAiMatch={actions.handleAiMatch}
      onClose={() => setPlayModeOpen(false)}
      onCreateRoom={actions.handleCreateRoom}
      onPartyMode={actions.handlePartyMode}
      onQuickMatch={actions.handleQuickMatch}
      onSignIn={actions.handleSignInRequest}
      onTutorial={actions.handleTutorial}
      open={playModeOpen}
      signedIn={authSession !== null}
    />
  )
  const supportDialog = <SupportDialog onClose={() => setSupportOpen(false)} open={supportOpen} />

  return {
    ...actions,
    handleSignOut,
    accountDialog,
    accountOpen,
    activeIndex,
    appNotice,
    authSession,
    codeDialog,
    codeEntryRef,
    game,
    handlePlay,
    hasFooter,
    navigate,
    playModeDialog,
    roomSession,
    setAccountOpen,
    setAppNotice,
    setCodeOpen,
    setSupportOpen,
    signOut,
    soundMuted,
    supportDialog,
    supportOpen,
    toggleSound,
    wide,
  }
}
