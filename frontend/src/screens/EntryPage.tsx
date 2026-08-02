import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { closeSession } from '@/api/authApi'
import { useLeaveSession } from '@/api/useRoomApi'
import type { AuthSession } from '@/authSession'
import { cn } from '@/cn'
import { AccountDialog, Avatar } from '@/components/AccountDialog'
import { LandingCodeDialog } from '@/components/LandingCodeDialog'
import { LandingHeroCarousel } from '@/components/LandingHeroCarousel'
import { LandingProgress } from '@/components/LandingProgress'
import { landingGameAt, landingGames } from '@/landingGames'
import { playLandingSoundtrack, setSoundtrackMuted } from '@/landingSoundtrack'
import { normalizeRoomCode } from '@/roomCode'
import { sessionScreenOf } from '@/sessionFsm'
import { readSoundMuted, saveSoundMuted } from '@/soundPreference'
import { selectSessionPhase, useAppStore } from '@/store'
import { useMediaQuery } from '@/useMediaQuery'

/** 이 폭 아래로는 화살표·팝오버 대신 스와이프 + 바텀시트 구조로 완전히 바꾼다. */
const WIDE_LAYOUT = '(min-width: 760px)'

const wordmark = 'font-mono font-bold tracking-[-0.03em] text-landing-text'
const wordmarkTag = 'font-mono font-bold tracking-[0.24em] text-landing-text-muted uppercase'
const primaryButton =
  'flex cursor-pointer items-center justify-center gap-3.5 rounded-[20px] border-0 bg-landing-accent font-bold text-landing-accent-ink shadow-landing-cta transition-colors duration-150 ease-out focus-visible:outline-3 focus-visible:outline-white focus-visible:outline-offset-3'
const lockedButton =
  'flex cursor-not-allowed items-center justify-center gap-3.5 rounded-[20px] border border-landing-hairline bg-landing-disabled font-bold text-landing-text-faint'
const noticeBase = 'm-0 text-center text-[12.5px]/[1.5] font-semibold text-landing-accent-text'

export function EntryPage() {
  const navigate = useNavigate()
  const wide = useMediaQuery(WIDE_LAYOUT)
  const [activeIndex, setActiveIndex] = useState(0)
  const [code, setCode] = useState('')
  const [codeOpen, setCodeOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const appNotice = useAppStore((state) => state.appNotice)
  const authSession = useAppStore((state) => state.authSession)
  const signOut = useAppStore((state) => state.signOut)
  const setAppNotice = useAppStore((state) => state.setAppNotice)

  const [soundMuted, setSoundMuted] = useState(readSoundMuted)

  const game = landingGameAt(activeIndex)

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
    playLandingSoundtrack(landingGameAt(index).key)
    setActiveIndex(index)
  }

  const handlePlay = () => {
    void navigate({ to: '/join', search: { code: undefined } })
  }

  const handleJoin = () => {
    // 이동이 막히거나 되돌아오는 경우에도 열린 채로 남지 않게 먼저 닫는다.
    setCodeOpen(false)
    void navigate({ to: '/join', search: { code: normalizeRoomCode(code) } })
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
          <header className="flex h-22 flex-none items-center justify-between gap-8 px-[max(2.75rem,env(safe-area-inset-left),env(safe-area-inset-right))]">
            <div className="flex items-center gap-5">
              <span className="flex items-baseline gap-2.5">
                <span className={cn(wordmark, 'text-[27px]/none')}>
                  YO<span className="text-landing-accent">R</span>R
                </span>
                <span className={cn(wordmarkTag, 'text-[11px]/none')}>Yorr Arcade</span>
              </span>
              <span aria-hidden="true" className="h-6.5 w-px bg-landing-hairline-strong" />
              <h1 className="m-0 text-[17px]/none font-bold whitespace-nowrap text-landing-text-strong">
                링크 하나로 모이면 바로 시작하는 파티 게임
              </h1>
            </div>
            <span className="flex min-w-0 items-center gap-2.5">
              {/* 게임 CTA와 다른 층 — 선택한 게임과 무관한 독립 진입 경로다. */}
              <CodeEntryRow compact onOpen={() => setCodeOpen(true)} />
              <span aria-hidden="true" className="h-6.5 w-px flex-none bg-landing-hairline" />
              <SoundToggle muted={soundMuted} onToggle={toggleSound} />
              <AccountControl
                layout="wide"
                onOpen={() => setAccountOpen(true)}
                open={accountOpen}
                session={authSession}
              />
            </span>
          </header>

          {/* 카드 폭은 화면 폭 기준(69.4% ≒ 1440에서 1000px)이라 캐러셀 띠는 전면 폭을 쓴다 —
              여기에 좌우 여백을 주면 카드와 화살표가 함께 안쪽으로 밀린다.
              높이는 narrow와 같은 원칙 — 남는 만큼 먹되(flex-1) 위로는 29.5rem에서 멈춘다.
              고정 높이로 두면 가로로 돌린 폰(760x420 등)에서 크롬 합계가 뷰포트를 넘어
              하단 CTA가 잘린다. */}
          {/* grow 가중치를 크게 줘서 아래 여백 블록보다 먼저 자란다 — 둘 다 flex-1이면
              남는 높이를 반씩 나눠 데스크톱에서 카드가 절반으로 작아진다. */}
          <div className="relative mt-[clamp(8px,3.5vh,32px)] max-h-[29.5rem] min-h-40 w-full flex-[999_1_0%]">
            <LandingHeroCarousel
              activeIndex={activeIndex}
              games={landingGames}
              layout="wide"
              onSelect={handleGameSelect}
            />
          </div>

          <div className="flex-none px-[max(2.75rem,env(safe-area-inset-left),env(safe-area-inset-right))] pt-[clamp(10px,2.4vh,22px)]">
            <LandingProgress
              activeIndex={activeIndex}
              games={landingGames}
              layout="wide"
              onSelect={handleGameSelect}
            />
          </div>

          {/* 진행 표시줄과 CTA 사이 남는 공간. 복귀 배너가 있으면 여기 들어앉는다. */}
          <div className="flex min-h-0 flex-1 flex-col items-center gap-3 px-[max(2.75rem,env(safe-area-inset-left),env(safe-area-inset-right))] pt-[clamp(10px,2.2vh,22px)]">
            <div className="flex w-full max-w-180 flex-col items-center gap-3">
              <ActiveRoomBanner />
              {appNotice && (
                <p className={noticeBase} role="status">
                  {appNotice}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-none items-center justify-center gap-5 px-[max(2.75rem,env(safe-area-inset-left),env(safe-area-inset-right))] pb-[clamp(20px,6vh,56px)]">
            {game.live ? (
              <button
                className={cn(primaryButton, 'h-18 px-13 text-[23px]')}
                onClick={handlePlay}
                type="button"
              >
                <PlayGlyph />
                {game.name} 플레이
              </button>
            ) : (
              <ComingSoonCta layout="wide" />
            )}
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
        <div className="flex flex-none items-center justify-between gap-3 px-5 pt-[max(14px,env(safe-area-inset-top))]">
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
            공통분모는 링크 진입 · 계정 없이 바로 · 실시간 멀티다. */}
        <h1 className="m-0 flex-none px-5 pt-[clamp(10px,2vh,18px)] text-[24px]/[1.25] font-bold tracking-[-0.02em] text-landing-text-strong">
          링크 하나로 모이면 바로 시작하는 파티 게임
        </h1>

        {/* 게임 선택과 무관한 독립 진입 경로라 게임 CTA 묶음 밖, 별도 층에 세운다.
            아래에 두면 선택한 게임의 보조 동작으로 읽히고, 준비 중인 게임에서는
            잠긴 버튼 아래 붙어 "이 게임을 코드로 연다"가 된다. */}
        <div className="flex-none px-5 pt-[clamp(10px,1.6vh,16px)]">
          <CodeEntryRow onOpen={() => setCodeOpen(true)} />
        </div>

        {/* 히어로가 남는 높이를 전부 먹는다. 나머지를 고정 높이로 두고 히어로만 늘고 줄면
            크롬 합계가 뷰포트를 넘을 수 없다 — h-svh + overflow-hidden에서 하단 CTA가
            잘려 접근 불가가 되는 것을 구조적으로 막는다(짧은 화면 하한은 min-h로 잡는다). */}
        <div className="relative mt-[clamp(8px,1.6vh,16px)] min-h-52 flex-1">
          <LandingHeroCarousel
            activeIndex={activeIndex}
            games={landingGames}
            layout="narrow"
            onSelect={handleGameSelect}
          />
        </div>

        <div className="flex-none px-5 pt-[clamp(10px,1.8vh,16px)]">
          <LandingProgress
            activeIndex={activeIndex}
            games={landingGames}
            layout="narrow"
            onSelect={handleGameSelect}
          />
        </div>

        <div className="flex flex-none flex-col gap-2.5 px-5 pb-[max(14px,env(safe-area-inset-bottom))]">
          <ActiveRoomBanner />
          {appNotice && (
            <p className={noticeBase} role="status">
              {appNotice}
            </p>
          )}
          {game.live ? (
            <button
              className={cn(primaryButton, 'h-15 w-full text-[19px] shadow-landing-cta-sheet')}
              onClick={handlePlay}
              type="button"
            >
              <PlayGlyph />
              {game.name} 플레이
            </button>
          ) : (
            <ComingSoonCta layout="narrow" />
          )}
        </div>
      </main>
      {codeDialog}
      {accountDialog}
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
 * 눌린 면(landing-well + 헤어라인)으로 그려 채워진 게임 CTA와 층 자체를 다르게 둔다.
 * 위계를 낮춘 게 아니라 다른 축에 세운 것이다 — 링크·QR 진입이 이 제품의 주 경로다.
 */
function CodeEntryRow({ compact = false, onOpen }: { compact?: boolean; onOpen: () => void }) {
  return (
    <button
      className={cn(
        'flex min-h-tap cursor-pointer items-center rounded-[14px] border border-landing-hairline-strong bg-landing-well font-semibold text-landing-text transition-colors duration-150 ease-out hover:border-landing-accent/70 hover:bg-landing-soft focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2',
        compact ? 'gap-2 px-4 text-[15px]' : 'w-full gap-2.5 px-4 text-[15px]',
      )}
      onClick={onOpen}
      type="button"
    >
      <CodeGlyph />
      초대 코드로 참가
      {!compact && (
        <span aria-hidden="true" className="ml-auto text-[18px]/none text-landing-text-faint">
          ›
        </span>
      )}
    </button>
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
      className="grid size-tap flex-none cursor-pointer place-items-center rounded-full border border-landing-hairline-strong bg-landing-well text-[15px]/none text-landing-text-muted transition-colors duration-150 ease-out hover:border-landing-accent/70 hover:text-landing-text focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2"
      onClick={onToggle}
      type="button"
    >
      <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
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
      aria-expanded={open}
      aria-haspopup="dialog"
      className={cn(
        'flex max-w-44 min-h-tap cursor-pointer items-center rounded-full border font-semibold transition-colors duration-150 ease-out focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2',
        open
          ? 'border-landing-accent/60 bg-landing-accent-tint text-landing-accent-text'
          : 'border-landing-hairline-strong bg-landing-well text-landing-text hover:border-landing-accent/70',
        wide ? 'gap-2.5 px-5 text-[15px]' : 'gap-2 px-3.5 text-[13px]',
      )}
      onClick={onOpen}
      type="button"
    >
      {session ? (
        <>
          <Avatar nickname={session.nickname} size="sm" />
          <span className="truncate">{session.nickname}</span>
        </>
      ) : (
        '로그인'
      )}
    </button>
  )
}

/**
 * 준비 중인 게임의 CTA. 눌리지 않는 버튼과 한 줄 안내가 한 묶음이다 —
 * 여기 있던 '출시 알림 받기'는 등록할 엔드포인트가 없어 안내만 띄우고 있었고,
 * 레퍼런스는 같은 자리를 "아직 못 누른다"는 사실 하나로 대체한다.
 */
function ComingSoonCta({ layout }: { layout: 'narrow' | 'wide' }) {
  const wide = layout === 'wide'

  return (
    <div className={cn('flex flex-none flex-col items-center', wide ? 'gap-3.5' : 'gap-2 w-full')}>
      <button
        className={cn(lockedButton, wide ? 'h-18 px-14 text-[22px]' : 'h-15 w-full text-[18px]')}
        disabled
        type="button"
      >
        <span aria-hidden="true" className="size-2.5 rounded-[2px] bg-current" />
        준비 중인 게임
      </button>
      <span className={cn('text-landing-text-muted', wide ? 'text-[15px]' : 'text-[14px]')}>
        곧 YORR ARCADE에 추가될 예정이에요.
      </span>
    </div>
  )
}

/** 방 코드 세 칸을 줄여 그린 아이콘. 무엇을 입력하는 버튼인지 글자 없이 한 번 더 말한다. */
function CodeGlyph() {
  return (
    <span aria-hidden="true" className="flex gap-[3px]">
      <span className="h-3.5 w-1.5 rounded-[2px] border border-current opacity-55" />
      <span className="h-3.5 w-1.5 rounded-[2px] border border-current opacity-55" />
      <span className="h-3.5 w-1.5 rounded-[2px] border border-current opacity-55" />
    </span>
  )
}

function PlayGlyph() {
  return (
    <span
      aria-hidden="true"
      className="size-0 border-y-[10px] border-l-[16px] border-y-transparent border-l-current"
    />
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
