import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { closeSession } from '@/auth/api/authApi'
import { AccountDialog } from '@/auth/components/AccountDialog'
import { type GameKey, gameAt, gameIndexOf, games } from '@/games'
import {
  AccountControl,
  ActiveRoomBanner,
  CodeEntryRow,
  SoundToggle,
} from '@/landing/components/EntryPage/parts'
import { LandingCodeDialog } from '@/landing/components/LandingCodeDialog'
import { LandingHeroCarousel } from '@/landing/components/LandingHeroCarousel'
import { LandingProgress } from '@/landing/components/LandingProgress'
import { PlayModeDialog } from '@/landing/components/PlayModeDialog'
import { RankingTicker } from '@/landing/components/RankingTicker'
import { normalizeRoomCode } from '@/room/domain/roomCode'
import { readSoundMuted, saveSoundMuted } from '@/shared/audio/soundPreference'
import { playLandingSoundtrack, setSoundtrackMuted } from '@/shared/audio/soundtrack'
import { cn } from '@/shared/cn'
import { useMediaQuery } from '@/shared/useMediaQuery'
import { useAppStore } from '@/store'

/** 이 폭 아래로는 화살표·팝오버 대신 스와이프 + 바텀시트 구조로 완전히 바꾼다. */
const WIDE_LAYOUT = '(min-width: 760px)'

const wordmark = 'font-mono font-bold tracking-[-0.03em] text-landing-text'
const wordmarkTag =
  'font-mono font-bold tracking-[0.24em] whitespace-nowrap text-landing-text-muted uppercase'
const noticeBase = 'm-0 text-center text-xs/[1.5] font-semibold text-landing-accent-text'

/**
 * narrow 화면 바닥 층. 복귀 배너·안내가 없으면 <b>상단 여백까지 지운다</b> — 비어 있는 층이
 * 12px를 물고 있으면 그만큼 히어로 카드가 못 자란다. 비었을 때 남는 건 바닥 여백뿐이다.
 */
const narrowFooter = {
  filled:
    'flex flex-none flex-col gap-2.5 px-5 pt-[clamp(10px,1.6vh,16px)] pb-[max(14px,env(safe-area-inset-bottom))]',
  empty: 'flex-none pb-[max(14px,env(safe-area-inset-bottom))]',
} as const

interface EntryPageProps {
  /**
   * URL `?game=`이 들고 있는 게임. 진입 시 캐러셀의 시작 칸을 정한다 — 없으면 첫 게임이다.
   * <p>
   * 마운트 시점의 <b>초기값으로만</b> 읽는다. 선택이 바뀌면 아래 handleGameSelect가 URL을
   * replace로 갱신하므로 이 화면이 떠 있는 동안 값이 밖에서 바뀔 일이 없고, 다른 화면에
   * 갔다 뒤로가기로 돌아오면 이 화면이 새로 마운트돼 새 초기값을 읽는다.
   */
  gameKey?: GameKey | undefined
}

export function EntryPage({ gameKey }: EntryPageProps) {
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
  if (wide) {
    return (
      <>
        <main className="relative flex h-svh w-full flex-col overflow-hidden [background:var(--ds-landing-bg)]">
          {/* 화면 맨 위 한 줄. 시세표처럼 이번 주 순위가 옆으로 흐른다 — 랜딩에 처음 온 사람이
              "여기서 뭘 겨루는지"를 읽기 전에 이미 보고 있게 된다. */}
          <RankingTicker layout="wide" />

          {/* 헤더 폭은 히어로 카드의 콘텐츠 영역(띠 폭의 69.4%)과 정확히 같다 — 화살표와
              이웃 카드가 쓰는 바깥 띠까지 헤더가 차지하면 로고와 계정 버튼이 화면 양끝으로
              벌어져 한 줄로 안 읽힌다. 안쪽 69.4%에 맞추면 워드마크 왼쪽 끝과 카드 왼쪽
              모서리가 같은 세로선에 선다. */}
          <header className="mx-auto flex h-22 w-full max-w-landing flex-none justify-center">
            <div className="flex w-[69.4%] items-center justify-between gap-8">
              <div className="flex items-center gap-5">
                <span className="flex items-baseline gap-2.5">
                  <span className={cn(wordmark, 'text-2xl/none')}>
                    YO<span className="text-landing-accent">R</span>R
                  </span>
                  <span className={cn(wordmarkTag, 'text-2xs/none')}>Yorr Arcade</span>
                </span>
                {/* 1200 아래에서는 이 한 줄을 접는다. 워드마크·초대 코드·계정은 줄어들 수
                    없고 이 카피만 줄바꿈 금지라, 760~1199에서 헤더 합계가 띠 폭(69.4%)을
                    넘어 justify-between이 옆으로 밀렸다. 가치 제안은 히어로 카드가 이미
                    말한다. sr-only로 접어 문서에는 h1을 남긴다 — hidden으로 지우면 이
                    구간에서 페이지에 제목이 하나도 없다. */}
                <span
                  aria-hidden="true"
                  className="hidden h-6.5 w-px bg-landing-hairline-strong desktop:block"
                />
                <h1 className="sr-only m-0 text-base/none font-bold whitespace-nowrap text-landing-text-strong desktop:not-sr-only">
                  링크 하나로 모이면 바로 시작하는 파티 게임
                </h1>
              </div>
              <span className="flex min-w-0 items-center gap-2.5">
                {/* 게임 CTA와 다른 층 — 선택한 게임과 무관한 독립 진입 경로다. */}
                <CodeEntryRow anchorRef={codeEntryRef} onOpen={() => setCodeOpen(true)} />
                <span aria-hidden="true" className="h-6.5 w-px flex-none bg-landing-hairline" />
                <SoundToggle muted={soundMuted} onToggle={toggleSound} />
                <AccountControl
                  layout="wide"
                  onOpen={() => setAccountOpen(true)}
                  open={accountOpen}
                  session={authSession}
                />
              </span>
            </div>
          </header>

          {/* 카드 폭은 띠 폭의 69.4%다. 그래서 폭 제한은 카드가 아니라 **띠**에 걸어야 한다 —
              카드에만 걸면 이웃 카드(띠 폭의 -12.2%)만 뷰포트를 따라가 중앙 카드에서 떨어져
              나가고, 아예 안 걸면 2560에서 카드가 1777×472(3.76:1) 레터박스가 된다.
              화살표(left-11)도 띠 기준이라 같이 안쪽으로 들어와 헤더 좌측단과 축이 맞는다.
              높이는 narrow와 같은 원칙 — 남는 만큼 먹되(flex-1) 위로는 상한에서 멈춘다.
              고정 높이로 두면 가로로 돌린 폰(760x420 등)에서 크롬 합계가 뷰포트를 넘어
              아래 내용이 잘린다.
              상한 32rem: 예전 29.5rem은 CTA가 카드 밖에 있던 시절 값이다. CTA가 카피 묶음의
              마지막 줄로 들어오면서 배지가 빠지고 버튼이 들어와 카드 하단 띠가 38px 두꺼워졌다
              — 상한도 같은 38px만 올려 3D 영역을 종전 이상으로 지킨다(472 + 38 = 510). */}
          {/* grow 가중치를 크게 줘서 아래 여백 블록보다 먼저 자란다 — 둘 다 flex-1이면
              남는 높이를 반씩 나눠 데스크톱에서 카드가 절반으로 작아진다. */}
          <div className="relative mx-auto mt-[clamp(8px,3.5vh,32px)] max-h-[min(42rem,66vh,56vw)] min-h-40 w-full max-w-landing flex-[999_1_0%]">
            <LandingHeroCarousel
              activeIndex={activeIndex}
              games={games}
              layout="wide"
              onPlay={handlePlay}
              onSelect={handleGameSelect}
            />
          </div>

          <div className="flex-none px-[max(2.75rem,env(safe-area-inset-left),env(safe-area-inset-right))] pt-[clamp(10px,2.4vh,22px)]">
            <LandingProgress
              activeIndex={activeIndex}
              games={games}
              layout="wide"
              onSelect={handleGameSelect}
            />
          </div>

          {/* 진행 표시줄 아래 남는 공간. 복귀 배너·안내가 여기 들어앉고, 비어 있으면 그대로
              화면 바닥 여백이 된다. 삭제한 CTA 층의 하단 여백(pb)을 이 층으로 옮겨,
              짧은 화면(932×430)에서 배너가 뷰포트 바닥에 붙는 것을 막는다. */}
          <div className="flex min-h-fit flex-1 flex-col items-center gap-3 px-[max(2.75rem,env(safe-area-inset-left),env(safe-area-inset-right))] pt-[clamp(10px,2.2vh,22px)] pb-[clamp(20px,6vh,56px)]">
            <div className="flex w-full max-w-180 flex-col items-center gap-3">
              <ActiveRoomBanner />
              {appNotice && (
                <p className={noticeBase} role="status">
                  {appNotice}
                </p>
              )}
            </div>
          </div>
        </main>
        {codeDialog}
        {accountDialog}
        {playModeDialog}
      </>
    )
  }

  return (
    <>
      <main className="relative flex h-svh w-full flex-col overflow-hidden [background:var(--ds-landing-bg)]">
        {/* 노치 여백은 이 띠가 물고 간다 — 띠가 화면 맨 위 층이 됐으므로 아래 로고 줄은
            고정 14px만 쓴다. 양쪽이 safe-area를 각각 물면 그만큼 히어로가 못 자란다. */}
        <div className="flex-none pt-[env(safe-area-inset-top)]">
          <RankingTicker layout="narrow" />
        </div>

        <div className="flex flex-none items-center justify-between gap-3 px-5 pt-3.5">
          <span className="flex items-baseline gap-2.5">
            <span className={cn(wordmark, 'text-2xl/none')}>
              YO<span className="text-landing-accent">R</span>R
            </span>
            <span className={cn(wordmarkTag, 'text-2xs/none')}>Arcade</span>
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <SoundToggle muted={soundMuted} onToggle={toggleSound} />
            <AccountControl
              layout="narrow"
              onOpen={() => setAccountOpen(true)}
              open={accountOpen}
              session={authSession}
            />
          </span>
        </div>

        {/* 랜딩의 최상위 카피는 "무엇인지"여야 한다 — 고르라는 지시는 캐러셀·진행 표시줄·
            스와이프 안내가 이미 하고 있다. 게임 5개(주사위·반응·드래그·타이밍)를 아우르는
            공통분모는 링크 진입 · 계정 없이 바로 · 실시간 멀티다.
            초대 코드는 이 카피의 오른쪽에 붙는다 — 게임 선택과 무관한 독립 경로라
            게임 CTA(이제 히어로 카드 안에 있다)와 여전히 다른 층이고, 세로로 한 층을
            따로 쓰지 않으므로 히어로가 그만큼 커진다. */}
        {/* 360px 미만에서는 나란히 두지 않는다. 초대 코드 칩이 shrink-0 116px이라 320px에서
            태그라인에 152px만 남고, 24px 글자로 4줄(120px)이 된다 — 한 층을 아끼려고 옆에
            붙인 것인데 그 층보다 큰 높이를 태그라인에서 되돌려 받는다. 쌓으면 태그라인이
            280px를 받아 2줄로 돌아오고 합계 높이도 오히려 줄어든다. */}
        <div className="flex flex-none items-center justify-between gap-3 px-5 pt-[clamp(10px,2vh,18px)] max-tiny:flex-col max-tiny:items-stretch max-tiny:gap-2.5">
          <h1 className="m-0 min-w-0 text-2xl/[1.25] font-bold tracking-[-0.02em] text-landing-text-strong">
            링크 하나로 모이면 바로 시작하는 파티 게임
          </h1>
          <CodeEntryRow anchorRef={codeEntryRef} onOpen={() => setCodeOpen(true)} />
        </div>

        {/* 히어로가 남는 높이를 전부 먹는다. 나머지를 고정 높이로 두고 히어로만 늘고 줄면
            크롬 합계가 뷰포트를 넘을 수 없다 — h-svh + overflow-hidden에서 아래 내용이
            잘려 접근 불가가 되는 것을 구조적으로 막는다(짧은 화면 하한은 min-h로 잡는다).
            CTA가 카드 안으로 들어가면서 바닥 층이 비면 그 높이가 통째로 여기로 돌아온다. */}
        <div className="relative mt-[clamp(8px,1.6vh,16px)] max-h-[36rem] min-h-52 flex-1">
          <LandingHeroCarousel
            activeIndex={activeIndex}
            games={games}
            layout="narrow"
            onPlay={handlePlay}
            onSelect={handleGameSelect}
          />
        </div>

        <div className="flex-none px-5 pt-[clamp(10px,1.8vh,16px)]">
          <LandingProgress
            activeIndex={activeIndex}
            games={games}
            layout="narrow"
            onSelect={handleGameSelect}
          />
        </div>

        <div className={narrowFooter[hasFooter ? 'filled' : 'empty']}>
          <ActiveRoomBanner />
          {appNotice && (
            <p className={noticeBase} role="status">
              {appNotice}
            </p>
          )}
        </div>
      </main>
      {codeDialog}
      {accountDialog}
      {playModeDialog}
    </>
  )
}

/**
 * 헤더 오른쪽 자리. 로그인 전에는 '로그인', 로그인 후에는 내 계정 버튼이다. 실제 내용은
 * 팝오버·바텀시트가 맡는다.
 * <p>
 * 원래 여기 있던 '방 코드로 참가'는 하단 CTA의 '초대 코드로 참가'와 같은 일을 하고 있었다.
 * 중복을 지우고 그 자리를 계정으로 넘긴다 — 헤더는 "지금 나는 누구인가", 하단은 "무엇을
 * 할 것인가"로 역할이 갈린다.
 * <p>
 * 여기에 제공자 버튼(카카오)을 직접 두지 않는다. 곧 구글이 붙어 자리를 나눠야 하고,
 * 어두운 랜딩 위에 브랜드 노란색을 얹으면 화면에서 그것만 튄다. 제공자 선택과 브랜드 색은
 * {@link AccountDialog} 안으로 들어간다.
 */
/**
 * 초대 코드 진입. 게임 선택과 무관한 **독립 경로**라 게임 CTA 묶음에 넣지 않는다 —
 * 거기 두면 primary 아래 secondary로 읽혀 "이 게임을 코드로 연다"가 되고, 준비 중인
 * 게임에서는 잠긴 버튼 아래 붙어 더 어긋난다.
 *
 * 알약 모양의 작은 채운 버튼이다. 층으로는 여전히 게임 CTA(히어로 카드 안)와 분리돼
 * 있고, 세로로 한 층을 따로 쓰지 않으므로 히어로가 그만큼 커진다. 레드로 채우되
 * <b>글로우는 주지 않는다</b> — 화면에서 빛나는 레드는 히어로 카드 안 플레이 CTA
 * 하나여야 하고, 이 버튼은 면적이 그 1/6이다.
 *
 * 보이는 글자는 "초대 코드"지만 접근 가능한 이름은 "초대 코드로 참가"다. 보이는 글자가
 * 그 이름에 포함되므로 WCAG 2.5.3 Label in Name을 만족한다.
 *
 * 데스크톱도 같은 모양을 쓴다. 예전에는 wide 헤더만 외곽선 사각형(compact) 변형이었는데,
 * 같은 일을 하는 버튼이 화면 폭에 따라 다른 물건으로 보였다.
 */
