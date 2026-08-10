import { type GameKey, games } from '@/games'
import {
  AccountControl,
  ActiveRoomBanner,
  CodeEntryRow,
  SoundToggle,
} from '@/landing/components/EntryPage/parts'
import { LandingHeroCarousel } from '@/landing/components/LandingHeroCarousel'
import { LandingProgress } from '@/landing/components/LandingProgress'
import { RankingTicker } from '@/landing/components/RankingTicker'
import { useEntryPage } from '@/landing/model/useEntryPage'
import { cn } from '@/shared/cn'

const wordmark = 'font-mono font-bold tracking-[-0.03em] text-landing-text'
const wordmarkTag =
  'font-mono font-bold tracking-[0.24em] whitespace-nowrap text-landing-text-muted uppercase'
const noticeBase = 'm-0 text-center text-xs/[1.5] font-semibold text-landing-accent-text'

const narrowFooter = {
  filled:
    'flex flex-none flex-col gap-2.5 px-5 pt-[clamp(10px,1.6vh,16px)] pb-[max(14px,env(safe-area-inset-bottom))]',
  empty: 'flex-none pb-[max(14px,env(safe-area-inset-bottom))]',
} as const

interface EntryPageProps {
  gameKey?: GameKey | undefined
}

export function EntryPage({ gameKey }: EntryPageProps) {
  const {
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
    handleGameSelect,
    handlePlay,
    hasFooter,
    playModeDialog,
    toggleSound,
    wide,
  } = useEntryPage(gameKey)

  if (wide) {
    return (
      <>
        <main className="relative flex h-svh w-full flex-col overflow-hidden [background:var(--ds-landing-bg)]">
          <RankingTicker layout="wide" />

          <header className="mx-auto flex h-22 w-full max-w-landing flex-none justify-center">
            <div className="flex w-[69.4%] items-center justify-between gap-8">
              <div className="flex items-center gap-5">
                <span className="flex items-baseline gap-2.5">
                  <span className={cn(wordmark, 'text-2xl/none')}>
                    YO<span className="text-landing-accent">R</span>R
                  </span>
                  <span className={cn(wordmarkTag, 'text-2xs/none')}>Yorr Arcade</span>
                </span>
                <span
                  aria-hidden="true"
                  className="hidden h-6.5 w-px bg-landing-hairline-strong desktop:block"
                />
                <h1 className="sr-only m-0 text-base/none font-bold whitespace-nowrap text-landing-text-strong desktop:not-sr-only">
                  링크 하나로 모이면 바로 시작하는 파티 게임
                </h1>
              </div>
              <span className="flex min-w-0 items-center gap-2.5">
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

        <div className="flex flex-none items-center justify-between gap-3 px-5 pt-[clamp(10px,2vh,18px)] max-tiny:flex-col max-tiny:items-stretch max-tiny:gap-2.5">
          <h1 className="m-0 min-w-0 text-2xl/[1.25] font-bold tracking-[-0.02em] text-landing-text-strong">
            링크 하나로 모이면 바로 시작하는 파티 게임
          </h1>
          <CodeEntryRow anchorRef={codeEntryRef} onOpen={() => setCodeOpen(true)} />
        </div>

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
