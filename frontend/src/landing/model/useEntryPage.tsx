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

/** 이 폭 아래로는 화살표·팝오버 대신 스와이프 + 바텀시트 구조로 완전히 바꾼다. */
const WIDE_LAYOUT = '(min-width: 760px)'

/**
 * 랜딩 화면의 상태 — 선택된 게임, 초대 코드 입력, 계정·모드 선택 다이얼로그, 소리 토글,
 * 그리고 방 만들기·참가 같은 진입 동작.
 */
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
  /**
   * 바닥 층에 실제로 그릴 게 있는가. ActiveRoomBanner는 roomSession이 없으면 null이다.
   *
   * 연습 모드 입구는 더 이상 여기서 세지 않는다 — 카드 안 플레이 버튼 위로 옮겼다.
   * 게임을 넘길 때마다 이 층이 생겼다 사라져 페이지 레이아웃이 흔들렸고, 320px에서는
   * 그만큼 히어로 카드가 눌렸다(LandingHeroCard의 TutorialEntry 주석).
   */
  const hasFooter = roomSession !== null || Boolean(appNotice)

  useEffect(() => {
    playLandingSoundtrack(game.key)
  }, [game.key])

  // 랜딩은 진입하자마자 BGM이 흐른다. 게임 화면과 같은 저장 설정을 쓰므로 여기서 끄면
  // 대기실·게임까지 그대로 따라간다(soundPreference는 방을 옮겨도 유지된다).
  const toggleSound = () => {
    const muted = !soundMuted
    setSoundMuted(muted)
    saveSoundMuted(muted)
    setSoundtrackMuted(muted)
  }

  /**
   * 고른 게임을 URL에 남긴다. `replace`인 이유: 카드를 넘기는 것은 화면 이동이 아니라 이 화면
   * 안의 위치 변경이라, 히스토리에 쌓으면 뒤로가기가 랜딩 안에서 게임을 하나씩 되짚느라
   * <b>직전 화면으로 못 나간다</b>. 덮어쓰면 다른 화면에서 돌아올 때 마지막 위치만 복원된다.
   *
   * `viewTransition: false`도 같은 이유다 — 라우터 기본값(defaultViewTransition)이 켜져
   * 있어 이 URL 갱신에도 <b>페이지 전체</b> 전환 연출(screen-push-in, 항상 오른쪽에서
   * 진입)이 발동했다. 왼쪽으로 넘겨도 히어로와 헤더가 오른쪽에서 밀려 들어와, 캐러셀
   * 자체의 슬라이드와 반대 방향으로 겹쳐 보였다.
   */
  const handleGameSelect = (index: number) => {
    const { key } = gameAt(index)
    playLandingSoundtrack(key)
    setActiveIndex(index)
    void navigate({ to: '/', search: { game: key }, replace: true, viewTransition: false })
  }

  // 플레이는 이제 곧바로 방을 만들지 않는다 — 친구와 할지, 모르는 사람과 할지부터 고른다.
  const handlePlay = () => setPlayModeOpen(true)

  const handleCreateRoom = () => {
    setPlayModeOpen(false)
    if (game.key === 'pingpong') {
      void navigate({ to: '/party', search: { game: 'pingpong' } })
      return
    }
    void navigate({ to: '/join', search: { code: undefined, game: game.key } })
  }

  /** 빠른 대전도 이름은 직접 짓는다 — 닉네임 화면에서 대기열에 선다. */
  const handleQuickMatch = () => {
    setPlayModeOpen(false)
    void navigate({ to: '/join', search: { code: undefined, game: game.key, mode: 'quick' } })
  }

  /** 연습 모드는 실전과 다른 화면이다 — 방을 만들지 않고 바로 들어간다. */
  const handleTutorial = () => {
    setPlayModeOpen(false)
    void navigate({ to: '/tutorial' })
  }

  /** 탁구 전용 로컬 AI 대전. 방도 서버도 없이 바로 붙는다. */
  const handleAiMatch = () => {
    setPlayModeOpen(false)
    void navigate({ to: '/pingpong' })
  }

  // 대시보드는 플레이어가 아니라 이름을 짓지 않는다 — 닉네임 화면을 거치지 않는다.
  const handlePartyMode = () => {
    setPlayModeOpen(false)
    // 고른 게임으로 열어야 한다 — 예전엔 'yacht'로 굳어 있어서, 결투 카드에서 눌러도
    // 요트 파티가 열렸다(카드는 결투인데 대시보드 제목만 바뀌어 있었다).
    void navigate({
      to: '/party',
      search: { game: game.key },
    })
  }

  const handleJoin = () => {
    // 이동이 막히거나 되돌아오는 경우에도 열린 채로 남지 않게 먼저 닫는다.
    setCodeOpen(false)
    void navigate({ to: '/join', search: { code: normalizeRoomCode(code), game: undefined } })
  }

  const handleSignOut = () => {
    setAccountOpen(false)
    // 서버 세션도 닫는다. 로컬만 지우면 그 토큰은 남은 30일 동안 서버에서 유효한 채로 남는다.
    // 실패해도 기다리지 않는다 — 로그아웃이 서버 사정에 묶이면 안 된다.
    if (authSession) void closeSession(authSession.sessionToken).catch(() => {})
    signOut()
    setAppNotice('로그아웃했어요.')
  }

  /**
   * 두 다이얼로그 모두 `<main>` <b>밖</b>에 그린다. `useDialogBackground`가 배경 `<main>`에
   * `inert`를 걸기 때문에, 안에 두면 열리는 순간 다이얼로그가 자기 자신을 잠가 아무것도
   * 눌리지 않는다(헤더 안에 뒀다가 실제로 그렇게 됐다).
   */
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
