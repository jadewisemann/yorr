import { type GameKey, games } from '@/games'
import {
  AccountControl,
  ActiveRoomBanner,
  CodeEntryRow,
  SoundToggle,
  SupportFab,
  ThemeToggle,
} from '@/landing/components/EntryPage/parts'
import { LandingHeroCarousel } from '@/landing/components/LandingHeroCarousel'
import { LandingProgress } from '@/landing/components/LandingProgress'
import { RankingTicker } from '@/landing/components/RankingTicker'
import { EntryDialogs, useEntryPage } from '@/landing/model/useEntryPage'
import { cn } from '@/shared/cn'
import { GameCanvas } from '@/shared/components/Screen'

const wordmark = 'font-mono font-bold tracking-[-0.03em] text-landing-text'
const wordmarkTag =
  'font-mono font-bold tracking-[0.24em] whitespace-nowrap text-landing-text-muted uppercase'
const noticeBase = 'm-0 text-center text-xs/[1.5] font-semibold text-landing-accent-text'

const narrowFooter = {
  filled:
    'flex flex-none flex-col gap-2 px-5 pt-[clamp(10px,1.6vh,16px)] pb-[max(14px,env(safe-area-inset-bottom))]',
  empty: 'flex-none pb-[max(14px,env(safe-area-inset-bottom))]',
} as const

interface EntryPageProps {
  gameKey?: GameKey | undefined
}

type EntryModel = ReturnType<typeof useEntryPage>

function Wordmark({ tag }: { tag: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className={cn(wordmark, 'text-2xl/none')}>
        YO<span className="text-landing-accent">R</span>R
      </span>
      <span className={cn(wordmarkTag, 'text-2xs/none')}>{tag}</span>
    </span>
  )
}

function AppNotice({ notice }: { notice: string | null | undefined }) {
  if (!notice) return null
  return (
    <p className={noticeBase} role="status">
      {notice}
    </p>
  )
}

/** 머리 띠 오른쪽의 음소거·테마·계정. 두 레이아웃이 순서까지 같다. */
function HeaderControls({ entry, layout }: { entry: EntryModel; layout: 'wide' | 'narrow' }) {
  return (
    <>
      <SoundToggle muted={entry.soundMuted} onToggle={entry.toggleSound} />
      <ThemeToggle />
      <AccountControl
        layout={layout}
        onOpen={() => entry.setAccountOpen(true)}
        open={entry.accountOpen}
        session={entry.authSession}
      />
    </>
  )
}

function WideHeader({ entry }: { entry: EntryModel }) {
  return (
    <header className="mx-auto flex h-22 w-full max-w-landing flex-none justify-center">
      <div className="flex w-[69.4%] items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <Wordmark tag="Yorr Arcade" />
          <span
            aria-hidden="true"
            className="hidden h-6.5 w-px bg-landing-hairline-strong desktop:block"
          />
          <h1 className="sr-only m-0 text-base/none font-bold whitespace-nowrap text-landing-text-strong desktop:not-sr-only">
            링크 하나로 모이면 바로 시작하는 파티 게임
          </h1>
        </div>
        <span className="flex min-w-0 items-center gap-2">
          <CodeEntryRow anchorRef={entry.codeEntryRef} onOpen={() => entry.setCodeOpen(true)} />
          <span aria-hidden="true" className="h-6.5 w-px flex-none bg-landing-hairline" />
          <HeaderControls entry={entry} layout="wide" />
        </span>
      </div>
    </header>
  )
}

function WideEntry({ entry }: { entry: EntryModel }) {
  return (
    <>
      <RankingTicker layout="wide" />

      <WideHeader entry={entry} />

      <div className="relative mx-auto mt-[clamp(8px,3.5vh,32px)] max-h-[min(42rem,66vh,56vw)] min-h-40 w-full max-w-landing flex-[999_1_0%]">
        <LandingHeroCarousel
          activeIndex={entry.activeIndex}
          games={games}
          layout="wide"
          onPlay={entry.handlePlay}
          onSelect={entry.handleGameSelect}
        />
      </div>

      <div className="flex-none px-[max(2.75rem,env(safe-area-inset-left),env(safe-area-inset-right))] pt-[clamp(10px,2.4vh,22px)]">
        <LandingProgress
          activeIndex={entry.activeIndex}
          games={games}
          layout="wide"
          onSelect={entry.handleGameSelect}
        />
      </div>

      <div className="flex min-h-fit flex-1 flex-col items-center gap-3 px-[max(2.75rem,env(safe-area-inset-left),env(safe-area-inset-right))] pt-[clamp(10px,2.2vh,22px)] pb-[clamp(20px,6vh,56px)]">
        <div className="flex w-full max-w-180 flex-col items-center gap-3">
          <ActiveRoomBanner />
          <AppNotice notice={entry.appNotice} />
        </div>
      </div>
      <SupportFab
        layout="wide"
        onOpen={() => entry.setSupportOpen(true)}
        open={entry.supportOpen}
      />
    </>
  )
}

function NarrowEntry({ entry }: { entry: EntryModel }) {
  return (
    <>
      <div className="flex-none pt-[env(safe-area-inset-top)]">
        <RankingTicker layout="narrow" />
      </div>

      <div className="flex flex-none items-center justify-between gap-3 px-5 pt-3.5">
        <Wordmark tag="Arcade" />
        <span className="flex min-w-0 items-center gap-2">
          <HeaderControls entry={entry} layout="narrow" />
        </span>
      </div>

      <div className="flex flex-none items-center justify-between gap-3 px-5 pt-[clamp(10px,2vh,18px)] max-tiny:flex-col max-tiny:items-stretch max-tiny:gap-2">
        <h1 className="m-0 min-w-0 text-2xl/[1.25] font-bold tracking-[-0.02em] text-landing-text-strong">
          링크 하나로 모이면 바로 시작하는 파티 게임
        </h1>
        <CodeEntryRow anchorRef={entry.codeEntryRef} onOpen={() => entry.setCodeOpen(true)} />
      </div>

      <div className="relative mt-[clamp(8px,1.6vh,16px)] max-h-[36rem] min-h-52 flex-1">
        <LandingHeroCarousel
          activeIndex={entry.activeIndex}
          games={games}
          layout="narrow"
          onPlay={entry.handlePlay}
          onSelect={entry.handleGameSelect}
        />
      </div>

      <div className="flex-none px-5 pt-[clamp(10px,1.8vh,16px)]">
        <LandingProgress
          activeIndex={entry.activeIndex}
          games={games}
          layout="narrow"
          onSelect={entry.handleGameSelect}
        />
      </div>

      <div className={narrowFooter[entry.hasFooter ? 'filled' : 'empty']}>
        <ActiveRoomBanner />
        <AppNotice notice={entry.appNotice} />
      </div>
      <SupportFab
        layout="narrow"
        onOpen={() => entry.setSupportOpen(true)}
        open={entry.supportOpen}
      />
    </>
  )
}

export function EntryPage({ gameKey }: EntryPageProps) {
  const entry = useEntryPage(gameKey)

  return (
    <>
      <GameCanvas className="flex flex-col [background:var(--ds-landing-bg)]">
        {entry.wide ? <WideEntry entry={entry} /> : <NarrowEntry entry={entry} />}
      </GameCanvas>
      <EntryDialogs {...entry.dialogs} />
    </>
  )
}
