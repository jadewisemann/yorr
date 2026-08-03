import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { closeSession } from '@/auth/api/authApi'
import type { AuthSession } from '@/auth/authSession'
import { AccountDialog, Avatar } from '@/auth/components/AccountDialog'
import { gameAt, games } from '@/games'
import { LandingCodeDialog } from '@/landing/components/LandingCodeDialog'
import { LandingHeroCarousel } from '@/landing/components/LandingHeroCarousel'
import { LandingProgress } from '@/landing/components/LandingProgress'
import { RankingTicker } from '@/landing/components/RankingTicker'
import { useLeaveSession } from '@/room/api/useRoomApi'
import { normalizeRoomCode } from '@/room/roomCode'
import { sessionScreenOf } from '@/room/sessionFsm'
import { readSoundMuted, saveSoundMuted } from '@/shared/audio/soundPreference'
import { playLandingSoundtrack, setSoundtrackMuted } from '@/shared/audio/soundtrack'
import { cn } from '@/shared/cn'
import { IconSound } from '@/shared/components/Icon'
import { useMediaQuery } from '@/shared/useMediaQuery'
import { selectSessionPhase, useAppStore } from '@/store'

/** 이 폭 아래로는 화살표·팝오버 대신 스와이프 + 바텀시트 구조로 완전히 바꾼다. */
const WIDE_LAYOUT = '(min-width: 760px)'

const wordmark = 'font-mono font-bold tracking-[-0.03em] text-landing-text'
const wordmarkTag =
  'font-mono font-bold tracking-[0.24em] whitespace-nowrap text-landing-text-muted uppercase'
const noticeBase = 'm-0 text-center text-[12.5px]/[1.5] font-semibold text-landing-accent-text'

/**
 * narrow 화면 바닥 층. 복귀 배너·안내가 없으면 <b>상단 여백까지 지운다</b> — 비어 있는 층이
 * 12px를 물고 있으면 그만큼 히어로 카드가 못 자란다. 비었을 때 남는 건 바닥 여백뿐이다.
 */
const narrowFooter = {
  filled:
    'flex flex-none flex-col gap-2.5 px-5 pt-[clamp(10px,1.6vh,16px)] pb-[max(14px,env(safe-area-inset-bottom))]',
  empty: 'flex-none pb-[max(14px,env(safe-area-inset-bottom))]',
} as const

export function EntryPage() {
  const navigate = useNavigate()
  const wide = useMediaQuery(WIDE_LAYOUT)
  const [activeIndex, setActiveIndex] = useState(0)
  const [code, setCode] = useState('')
  const [codeOpen, setCodeOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const appNotice = useAppStore((state) => state.appNotice)
  const authSession = useAppStore((state) => state.authSession)
  const roomSession = useAppStore((state) => state.roomSession)
  const signOut = useAppStore((state) => state.signOut)
  const setAppNotice = useAppStore((state) => state.setAppNotice)

  const [soundMuted, setSoundMuted] = useState(readSoundMuted)

  const game = gameAt(activeIndex)
  /**
   * 바닥 층에 실제로 그릴 게 있는가. ActiveRoomBanner는 roomSession이 없으면 null이다.
   * 연습 모드 입구는 플레이할 수 있는 게임에서만 서므로(준비 중인 게임의 연습은 없다)
   * 그것도 같이 센다.
   */
  const hasFooter = roomSession !== null || Boolean(appNotice) || game.live

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

  const handleGameSelect = (index: number) => {
    playLandingSoundtrack(gameAt(index).key)
    setActiveIndex(index)
  }

  const handlePlay = () => {
    if (game.key === 'pingpong') {
      void navigate({ to: '/party', search: { game: 'pingpong' } })
      return
    }
    void navigate({ to: '/join', search: { code: undefined, game: game.key } })
  }

  /** 연습 모드는 실전과 다른 화면이다 — 방을 만들지 않고 바로 들어간다. */
  const handleTutorial = () => {
    void navigate({ to: '/tutorial' })
  }

  // 대시보드는 플레이어가 아니라 이름을 짓지 않는다 — 닉네임 화면을 거치지 않는다.
  const handleOpenParty = () => {
    if (game.key === 'pingpong') {
      void navigate({ to: '/pingpong' })
      return
    }
    void navigate({
      to: '/party',
      search: { game: 'yacht' },
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
                  <span className={cn(wordmark, 'text-[27px]/none')}>
                    YO<span className="text-landing-accent">R</span>R
                  </span>
                  <span className={cn(wordmarkTag, 'text-[11px]/none')}>Yorr Arcade</span>
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
                <h1 className="sr-only m-0 text-[17px]/none font-bold whitespace-nowrap text-landing-text-strong desktop:not-sr-only">
                  링크 하나로 모이면 바로 시작하는 파티 게임
                </h1>
              </div>
              <span className="flex min-w-0 items-center gap-2.5">
                {/* 게임 CTA와 다른 층 — 선택한 게임과 무관한 독립 진입 경로다. */}
                <CodeEntryRow onOpen={() => setCodeOpen(true)} />
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
              onPartyMode={handleOpenParty}
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
              {game.key === 'yacht' && <TutorialLink onClick={handleTutorial} />}
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
            <span className={cn(wordmark, 'text-[24px]/none')}>
              YO<span className="text-landing-accent">R</span>R
            </span>
            <span className={cn(wordmarkTag, 'text-[10px]/none')}>Arcade</span>
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
          <h1 className="m-0 min-w-0 text-[24px]/[1.25] font-bold tracking-[-0.02em] text-landing-text-strong">
            링크 하나로 모이면 바로 시작하는 파티 게임
          </h1>
          <CodeEntryRow onOpen={() => setCodeOpen(true)} />
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
            onPartyMode={handleOpenParty}
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
          {game.key === 'yacht' && <TutorialLink onClick={handleTutorial} />}
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
    </>
  )
}

/**
 * 연습 모드 진입(S15P11A406-143). 실전에 들어가기 전에 고를 수 있어야 하는 선택이라
 * 플레이 CTA와 같은 흐름에 둔다 — 게임 안에서는 더 이상 한 턴 튜토리얼을 켜지 않는다.
 * <p>
 * 카드 <b>안</b>(CTA 바로 아래)이 아니라 진행 표시줄 아래 층에 서는 이유: 카드 하단 띠는
 * 플레이·준비중 두 상태의 높이가 같아야 캐러셀이 미끄러질 때 흔들리지 않는다
 * ({@link LandingHeroCard}의 HeroCta 주석). live에서만 한 줄이 붙으면 그 전제가 깨진다.
 * <p>
 * 준비 중인 게임에서는 그리지 않는다 — 연습할 것이 아직 없다.
 */
function TutorialLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="cursor-pointer border-0 bg-transparent p-1 text-[14px] font-semibold text-landing-text-muted underline underline-offset-4 transition-colors duration-150 ease-out hover:text-landing-text focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2"
      onClick={onClick}
      type="button"
    >
      처음이신가요? 튜토리얼로 연습하기
    </button>
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
const codeEntry =
  'flex min-h-tap shrink-0 cursor-pointer items-center gap-2 rounded-full border-0 bg-landing-accent pr-3 pl-4 text-[14px] font-landing-bold text-landing-accent-ink outline-white transition-colors duration-150 ease-out hover:bg-landing-accent/90 focus-visible:outline-3 focus-visible:outline-offset-2'

function CodeEntryRow({ onOpen }: { onOpen: () => void }) {
  return (
    <button aria-label="초대 코드로 참가" className={codeEntry} onClick={onOpen} type="button">
      초대 코드
      {/* 글자 뒤에 입력 필드를 줄여 그린다 — 코드 칸 세 개를 그린 아이콘은 "무엇을
          누르는가"를 말하지 못했다. 커서가 깜빡이는 빈 칸은 "여기에 쳐 넣는다"로 읽힌다. */}
      <InputGlyph />
    </button>
  )
}

/** 커서가 선 입력 칸. 누르면 코드를 타이핑하는 화면이 뜬다는 예고다. */
function InputGlyph() {
  return (
    <span
      aria-hidden="true"
      className="flex h-6 w-7 flex-none items-center justify-center rounded-[7px] border border-current/45 bg-current/12"
    >
      <span className="h-3 w-px bg-current motion-safe:animate-caret-blink" />
    </span>
  )
}

/**
 * 랜딩 BGM 음소거. 게임 화면 헤더의 소리 버튼과 같은 저장 설정(soundPreference)을 쓴다 —
 * 조용한 곳에서 한 번 끈 사람은 방을 옮겨도 계속 조용해야 한다.
 */
function SoundToggle({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button
      aria-label={muted ? '소리 켜기' : '소리 끄기'}
      aria-pressed={!muted}
      className="grid size-tap flex-none cursor-pointer place-items-center rounded-full border border-landing-hairline-strong bg-landing-well text-landing-text-muted transition-colors duration-150 ease-out hover:border-landing-accent/70 hover:text-landing-text focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2"
      onClick={onToggle}
      type="button"
    >
      <IconSound className="size-4.5" muted={muted} />
    </button>
  )
}

function AccountControl({
  layout,
  onOpen,
  open,
  session,
}: {
  layout: 'narrow' | 'wide'
  onOpen: () => void
  open: boolean
  session: AuthSession | null
}) {
  const wide = layout === 'wide'

  return (
    <button
      // 로그인 상태에서는 닉네임을 그리지 않으므로 버튼에 보이는 글자가 없다 —
      // 누구의 계정인지는 접근 가능한 이름이 대신 말한다.
      aria-label={session ? `내 계정, ${session.nickname}` : undefined}
      aria-expanded={open}
      aria-haspopup="dialog"
      className={cn(
        'flex max-w-44 min-h-tap cursor-pointer items-center rounded-full border font-semibold transition-colors duration-150 ease-out focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2',
        open
          ? 'border-landing-accent/60 bg-landing-accent-tint text-landing-accent-text'
          : 'border-landing-hairline-strong bg-landing-well text-landing-text hover:border-landing-accent/70',
        // 아바타 하나뿐이면 가로 여백이 필요 없다 — 탭 타깃 크기의 원형으로 세운다.
        session
          ? 'size-tap justify-center px-0'
          : wide
            ? 'gap-2.5 px-5 text-[15px]'
            : 'gap-2 px-3.5 text-[13px]',
      )}
      onClick={onOpen}
      type="button"
    >
      {session ? <Avatar nickname={session.nickname} size="lg" /> : '로그인'}
    </button>
  )
}

/**
 * 참여 중인 방이 있을 때만 뜨는 복귀 배너. (S15P11A406-101)
 * 예전처럼 홈에서 방으로 강제 리다이렉트하면 세션이 있는 한 홈으로 돌아올 수도,
 * 세션을 정리할 수도 없다 — 돌아갈지 나갈지는 사용자가 고른다.
 */
function ActiveRoomBanner() {
  const navigate = useNavigate()
  const roomSession = useAppStore((state) => state.roomSession)
  const roomResumeReason = useAppStore((state) => state.roomResumeReason)
  const resumeRoomSession = useAppStore((state) => state.resumeRoomSession)
  const sessionPhase = useAppStore(selectSessionPhase)
  const { isLeaving, leave } = useLeaveSession()

  if (!roomSession) return null

  const handleReturn = () => {
    resumeRoomSession()
    void navigate({
      to: sessionScreenOf(sessionPhase) === 'game' ? '/rooms/$roomId/game' : '/rooms/$roomId/lobby',
      params: { roomId: roomSession.roomId },
    })
  }

  const needsResume = roomResumeReason !== null
  const returnLabel = roomResumeReason === 'disconnected' ? '다시 연결' : '이어서 하기'

  return (
    <section
      aria-label="진행 중인 방"
      className={cn(
        'flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[18px] border px-4 py-3 shadow-landing-panel',
        needsResume
          ? 'border-landing-accent/45 bg-landing-accent-tint'
          : 'border-transparent bg-landing-well',
      )}
    >
      <p className="m-0 flex min-w-0 items-center gap-3 text-[13px]/[1.4] font-landing-medium text-landing-text-strong">
        {needsResume && (
          <span
            aria-hidden="true"
            className="size-2.5 flex-none rounded-full bg-landing-accent-text shadow-[0_0_12px_currentColor] motion-safe:animate-ring-pulse"
          />
        )}
        <span className="min-w-0">
          <strong className="block font-landing-bold">
            {needsResume ? '진행 중인 게임이 있어요' : `${roomSession.roomCode} 방에 참여 중이에요`}
          </strong>
          {needsResume && (
            <span className="text-landing-text-muted">
              {roomSession.roomCode} · {roomSession.nickname}
            </span>
          )}
        </span>
      </p>
      <div className="flex flex-none items-center gap-2">
        <button
          className="min-h-tap cursor-pointer rounded-[14px] border-0 bg-landing-accent px-4 py-2.5 text-[14px] font-landing-bold text-landing-accent-ink focus-visible:outline-3 focus-visible:outline-white focus-visible:outline-offset-2"
          onClick={handleReturn}
          type="button"
        >
          {needsResume ? returnLabel : '돌아가기'}
        </button>
        <button
          className="min-h-tap cursor-pointer rounded-full border-0 bg-transparent px-2.5 py-2 text-[13px] font-landing-bold text-landing-text-muted underline-offset-2 hover:underline focus-visible:outline-3 focus-visible:outline-white focus-visible:outline-offset-2 disabled:opacity-60"
          disabled={isLeaving}
          onClick={() => void leave()}
          type="button"
        >
          나가기
        </button>
      </div>
    </section>
  )
}
