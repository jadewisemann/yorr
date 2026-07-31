import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useLeaveSession } from '@/api/useRoomApi'
import { cn } from '@/cn'
import { LandingCodeDialog } from '@/components/LandingCodeDialog'
import { LandingMetaPills } from '@/components/LandingHeroCard'
import { LandingHeroCarousel } from '@/components/LandingHeroCarousel'
import { LandingProgress } from '@/components/LandingProgress'
import { landingGameAt, landingGames } from '@/landingGames'
import { playLandingSoundtrack } from '@/landingSoundtrack'
import { normalizeRoomCode } from '@/roomCode'
import { sessionScreenOf } from '@/sessionFsm'
import { selectSessionPhase, useAppStore } from '@/store'
import { useMediaQuery } from '@/useMediaQuery'

/** 이 폭 아래로는 화살표·팝오버 대신 스와이프 + 바텀시트 구조로 완전히 바꾼다. */
const WIDE_LAYOUT = '(min-width: 760px)'

const wordmark = 'font-mono font-bold tracking-[-0.03em] text-landing-text'
const wordmarkTag = 'font-mono font-bold tracking-[0.24em] text-landing-text-muted uppercase'
const ghostButton =
  'flex cursor-pointer items-center justify-center rounded-[16px] border border-landing-hairline-strong bg-transparent font-semibold text-landing-text-muted transition-colors duration-150 ease-out hover:border-landing-hairline-strong hover:text-landing-text focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2'
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
  const appNotice = useAppStore((state) => state.appNotice)

  const game = landingGameAt(activeIndex)

  useEffect(() => {
    playLandingSoundtrack(game.key)
  }, [game.key])

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
  if (wide) {
    return (
      <>
        <main className="relative flex h-svh w-full flex-col overflow-hidden [background:var(--ds-landing-bg)]">
          <header className="flex h-22 flex-none items-center justify-between gap-8 px-11">
            <div className="flex items-center gap-5">
              <span className="flex items-baseline gap-2.5">
                <span className={cn(wordmark, 'text-[27px]/none')}>
                  YO<span className="text-landing-accent">R</span>R
                </span>
                <span className={cn(wordmarkTag, 'text-[11px]/none')}>Yorr Arcade</span>
              </span>
              <span aria-hidden="true" className="h-6.5 w-px bg-landing-hairline-strong" />
              <span className="text-[17px]/none font-bold text-landing-text-strong">
                게임을 선택하세요
              </span>
            </div>
            <button
              className={cn(
                'flex h-11 cursor-pointer items-center gap-2.5 rounded-full border px-5 text-[15px] font-semibold transition-colors duration-150 ease-out focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2',
                codeOpen
                  ? 'border-landing-accent/60 bg-landing-accent-tint text-landing-accent-text'
                  : 'border-landing-hairline-strong bg-landing-well text-landing-text hover:border-landing-accent/70',
              )}
              onClick={() => setCodeOpen(true)}
              type="button"
            >
              <CodeGlyph />방 코드로 참가
            </button>
          </header>

          {/* 카드 폭은 화면 폭 기준(69.4% ≒ 1440에서 1000px)이라 캐러셀 띠는 전면 폭을 쓴다 —
              여기에 좌우 여백을 주면 카드와 화살표가 함께 안쪽으로 밀린다. */}
          <div className="relative mt-[clamp(8px,3.5vh,32px)] h-[min(29.5rem,52vh)] w-full flex-none">
            <LandingHeroCarousel
              activeIndex={activeIndex}
              games={landingGames}
              layout="wide"
              onSelect={handleGameSelect}
            />
          </div>

          <div className="flex-none px-11 pt-[clamp(10px,2.4vh,22px)]">
            <LandingProgress
              activeIndex={activeIndex}
              games={landingGames}
              layout="wide"
              onSelect={handleGameSelect}
            />
          </div>

          {/* 진행 표시줄과 CTA 사이 남는 공간. 복귀 배너가 있으면 여기 들어앉는다. */}
          <div className="flex min-h-0 flex-1 flex-col items-center gap-3 px-11 pt-[clamp(10px,2.2vh,22px)]">
            <div className="flex w-full max-w-180 flex-col items-center gap-3">
              <ActiveRoomBanner />
              {appNotice && (
                <p className={noticeBase} role="status">
                  {appNotice}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-none justify-center px-11 pb-[clamp(20px,6vh,56px)]">
            {game.live ? (
              <div className="flex items-center justify-center gap-4.5">
                <button
                  className={cn(primaryButton, 'h-18 px-13 text-[23px]')}
                  onClick={handlePlay}
                  type="button"
                >
                  <PlayGlyph />
                  {game.name} 플레이
                </button>
                <button
                  className={cn(ghostButton, 'h-14 px-6.5 text-[16px]')}
                  onClick={() => setCodeOpen(true)}
                  type="button"
                >
                  초대 코드로 참가
                </button>
              </div>
            ) : (
              <ComingSoonCta layout="wide" />
            )}
          </div>
        </main>
        {codeDialog}
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
          <button
            className={cn(
              'flex h-9 cursor-pointer items-center rounded-full border px-3.5 text-[13px] font-semibold transition-colors focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2',
              codeOpen
                ? 'border-landing-accent/55 bg-landing-accent-tint text-landing-accent-text'
                : 'border-landing-hairline-strong bg-landing-well text-landing-text',
            )}
            onClick={() => setCodeOpen(true)}
            type="button"
          >
            코드로 참가
          </button>
        </div>

        <span className="flex-none px-5 pt-4.5 text-[24px]/none font-bold tracking-[-0.02em] text-landing-text-strong">
          게임을 선택하세요
        </span>

        <div className="relative mt-4 h-[51%] flex-none">
          <LandingHeroCarousel
            activeIndex={activeIndex}
            games={landingGames}
            layout="narrow"
            onSelect={handleGameSelect}
          />
        </div>

        <div className="flex flex-none flex-wrap gap-1.5 px-5 pt-4">
          <LandingMetaPills game={game} layout="narrow" />
        </div>

        <div className="flex-none px-5 pt-4">
          <LandingProgress
            activeIndex={activeIndex}
            games={landingGames}
            layout="narrow"
            onSelect={handleGameSelect}
          />
        </div>

        <div className="min-h-3 flex-1" />

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
    </>
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
          className="cursor-pointer rounded-[14px] border-0 bg-landing-accent px-4 py-2.5 text-[14px] font-landing-bold text-landing-accent-ink focus-visible:outline-3 focus-visible:outline-white focus-visible:outline-offset-2"
          onClick={handleReturn}
          type="button"
        >
          {needsResume ? returnLabel : '돌아가기'}
        </button>
        <button
          className="cursor-pointer rounded-full border-0 bg-transparent px-2 py-2 text-[13px] font-landing-bold text-landing-text-muted underline-offset-2 hover:underline focus-visible:outline-3 focus-visible:outline-white focus-visible:outline-offset-2 disabled:opacity-60"
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
