import { useNavigate } from '@tanstack/react-router'
import { type RefObject, useEffect, useRef, useState } from 'react'
import type { AuthSession } from '@/auth/authSession'
import { AccountDialog } from '@/auth/components/AccountDialog'
import { type Game, type GameKey, gameAt, gameIndexOf } from '@/games'
import { LandingCodeDialog } from '@/landing/components/LandingCodeDialog'
import { PlayModeDialog } from '@/landing/components/PlayModeDialog'
import { SupportDialog } from '@/landing/components/SupportDialog'
import { readSoundMuted, saveSoundMuted } from '@/shared/audio/soundPreference'
import { playLandingSoundtrack, setSoundtrackMuted } from '@/shared/audio/soundtrack'
import { useMediaQuery } from '@/shared/useMediaQuery'
import { useAppStore } from '@/store'
import { useAccountActions, useEntryNavigation } from './useEntryNavigation'

const WIDE_LAYOUT = '(min-width: 760px)'

/** 랜딩의 네 다이얼로그(방 코드·계정·플레이 모드·문의)의 열림 상태. */
function useDialogFlags() {
  const [codeOpen, setCodeOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [playModeOpen, setPlayModeOpen] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  return {
    accountOpen,
    codeOpen,
    playModeOpen,
    setAccountOpen,
    setCodeOpen,
    setPlayModeOpen,
    setSupportOpen,
    supportOpen,
  }
}

/** 배경음 음소거 토글. 고른 게임이 바뀌면 그 게임의 배경음으로 갈아 낀다. */
function useEntrySound(gameKey: GameKey) {
  const [soundMuted, setSoundMuted] = useState(readSoundMuted)

  useEffect(() => {
    playLandingSoundtrack(gameKey)
  }, [gameKey])

  const toggleSound = () => {
    const muted = !soundMuted
    setSoundMuted(muted)
    saveSoundMuted(muted)
    setSoundtrackMuted(muted)
  }

  return { soundMuted, toggleSound }
}

interface EntryDialogsProps {
  actions: ReturnType<typeof useEntryNavigation>
  authSession: AuthSession | null
  code: string
  codeEntryRef: RefObject<HTMLButtonElement | null>
  flags: ReturnType<typeof useDialogFlags>
  game: Game
  onCodeChange: (code: string) => void
  onSignOut: () => void
  wide: boolean
}

/** 랜딩 화면이 띄우는 다이얼로그 넷. 넓은 화면의 방 코드 창만 앵커 없이 고정 자리에 뜬다. */
export function EntryDialogs({
  actions,
  authSession,
  code,
  codeEntryRef,
  flags,
  game,
  onCodeChange,
  onSignOut,
  wide,
}: EntryDialogsProps) {
  const layout = wide ? 'wide' : 'narrow'
  return (
    <>
      <LandingCodeDialog
        anchorRef={wide ? undefined : codeEntryRef}
        code={code}
        layout={layout}
        onClose={() => flags.setCodeOpen(false)}
        onCodeChange={onCodeChange}
        onSubmit={actions.handleJoin}
        open={flags.codeOpen}
      />
      <AccountDialog
        layout={layout}
        onClose={() => flags.setAccountOpen(false)}
        onSignOut={onSignOut}
        open={flags.accountOpen}
        session={authSession}
      />
      <PlayModeDialog
        game={game}
        onAiMatch={actions.handleAiMatch}
        onClose={() => flags.setPlayModeOpen(false)}
        onCreateRoom={actions.handleCreateRoom}
        onPartyMode={actions.handlePartyMode}
        onQuickMatch={actions.handleQuickMatch}
        onSignIn={actions.handleSignInRequest}
        onTutorial={actions.handleTutorial}
        open={flags.playModeOpen}
        signedIn={authSession !== null}
      />
      <SupportDialog onClose={() => flags.setSupportOpen(false)} open={flags.supportOpen} />
    </>
  )
}

/** 랜딩 화면의 상태·다이얼로그·동작을 한 묶음으로. 이동 동작은 `useEntryNavigation`에 있다. */
export function useEntryPage(gameKey: GameKey | undefined) {
  const navigate = useNavigate()
  const wide = useMediaQuery(WIDE_LAYOUT)
  const [activeIndex, setActiveIndex] = useState(() => gameIndexOf(gameKey))
  const [code, setCode] = useState('')
  const flags = useDialogFlags()
  const codeEntryRef = useRef<HTMLButtonElement>(null)
  const appNotice = useAppStore((state) => state.appNotice)
  const authSession = useAppStore((state) => state.authSession)
  const roomSession = useAppStore((state) => state.roomSession)
  const signOut = useAppStore((state) => state.signOut)
  const setAppNotice = useAppStore((state) => state.setAppNotice)

  const game = gameAt(activeIndex)
  const { setAccountOpen } = flags

  const actions = useEntryNavigation({
    activeIndex,
    code,
    navigate,
    setAccountOpen,
    setActiveIndex,
    setCodeOpen: flags.setCodeOpen,
    setPlayModeOpen: flags.setPlayModeOpen,
  })
  const handleSignOut = useAccountActions({ authSession, setAccountOpen, setAppNotice, signOut })
  const sound = useEntrySound(game.key)

  const dialogs: EntryDialogsProps = {
    actions,
    authSession,
    code,
    codeEntryRef,
    flags,
    game,
    onCodeChange: setCode,
    onSignOut: handleSignOut,
    wide,
  }

  return {
    ...flags,
    ...sound,
    activeIndex,
    appNotice,
    authSession,
    codeEntryRef,
    dialogs,
    handleGameSelect: actions.handleGameSelect,
    handlePlay: () => flags.setPlayModeOpen(true),
    hasFooter: roomSession !== null || Boolean(appNotice),
    wide,
  }
}
