import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useLeaveSession } from '@/api/useRoomApi'
import { cn } from '@/cn'
import { HeroCanvas } from '@/components/HeroCanvas'
import { LandingGameList } from '@/components/LandingGameList'
import { LandingGameRail } from '@/components/LandingGameRail'
import { LandingHeroCopy } from '@/components/LandingHeroCopy'
import { LandingRoomCodeForm } from '@/components/LandingRoomCodeForm'
import { LANDING_PANEL_ID, landingGameAt, landingGames, landingTabId } from '@/landingGames'
import { normalizeRoomCode } from '@/roomCode'
import { sessionScreenOf } from '@/sessionFsm'
import { selectSessionPhase, useAppStore } from '@/store'
import { useMediaQuery } from '@/useMediaQuery'

/** 이 폭 아래로는 세로 목록 대신 칩 레일 + 바텀시트 구조로 완전히 바꾼다. */
const WIDE_LAYOUT = '(min-width: 760px)'

const primaryBase =
  'flex cursor-pointer items-center justify-center rounded-full border-0 font-bold transition-colors duration-150 ease-out focus-visible:outline-3 focus-visible:outline-white focus-visible:outline-offset-3'
const skipLinkBase =
  'absolute top-0 left-[-9999px] z-toast rounded-full bg-landing-accent px-[18px] py-3 text-[14px] font-landing-bold text-landing-accent-ink'
const hintBase = 'm-0 font-landing-medium text-pretty text-landing-text-muted'
const noticeBase = 'm-0 text-[12.5px]/[1.5] font-semibold text-landing-accent-text'

export function EntryPage() {
  const navigate = useNavigate()
  const wide = useMediaQuery(WIDE_LAYOUT)
  const [activeIndex, setActiveIndex] = useState(0)
  const [code, setCode] = useState('')
  const [notifyNotice, setNotifyNotice] = useState<string | null>(null)
  const appNotice = useAppStore((state) => state.appNotice)

  const game = landingGameAt(activeIndex)
  const notice = notifyNotice ?? appNotice

  const handleSelect = (index: number) => {
    setActiveIndex(index)
    setNotifyNotice(null)
  }

  const handlePrimary = () => {
    if (game.live) {
      void navigate({ to: '/join', search: { code: undefined } })
      return
    }
    // TODO(S15P11A406-77): 출시 알림 신청 엔드포인트가 생기면 실제 등록으로 교체한다.
    setNotifyNotice(`${game.name} 출시 알림 신청은 아직 열리지 않았습니다. 공개되면 안내드릴게요.`)
  }

  const handleJoin = () => {
    void navigate({ to: '/join', search: { code: normalizeRoomCode(code) } })
  }

  const hint = game.live
    ? wide
      ? '방을 만들면 방 코드와 초대 링크가 함께 생깁니다. 받은 사람은 닉네임만 정하고 들어옵니다.'
      : '방을 만들면 방 코드와 초대 링크가 함께 생깁니다.'
    : `${game.name}은(는) 준비 중입니다. 공개되면 알려드립니다.`
  const primaryLabel = game.live ? '방 만들기' : '출시 알림 받기'

  if (wide) {
    return (
      <main className="relative h-svh w-full overflow-hidden [background:var(--ds-landing-bg-wide)]">
        <a className={cn(skipLinkBase, 'focus:top-5 focus:left-5')} href="#room-code">
          방 코드 입력으로 바로가기
        </a>

        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-1">
          <HeroCanvas game={game.key} />
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-2 [background:var(--ds-landing-scrim)]"
        />

        <div className="absolute inset-0 z-3 flex flex-col px-[clamp(20px,4vw,54px)] py-[clamp(20px,3vh,30px)]">
          <div className="flex flex-none items-center justify-between gap-4">
            <span className="flex items-baseline gap-2.5">
              <span className="font-mono text-[21px]/none font-bold tracking-[-0.03em] text-landing-text">
                YO<span className="text-landing-accent">R</span>R
              </span>
              <span className="font-mono text-[10px]/none font-bold tracking-[0.24em] text-landing-text-muted uppercase">
                Arcade
              </span>
            </span>
            <span className="text-[13px]/none font-landing-bold tracking-[0.02em] text-landing-text-secondary">
              설치도 회원가입도 없어요
            </span>
          </div>

          <div className="flex min-h-0 flex-1 items-end justify-between gap-[clamp(24px,5vw,72px)] pt-[clamp(16px,3vh,32px)]">
            <div
              aria-labelledby={landingTabId(game.key)}
              className="flex max-w-[min(620px,58%)] flex-col items-start gap-3.5"
              id={LANDING_PANEL_ID}
              role="tabpanel"
            >
              <LandingHeroCopy game={game} layout="wide" />
              <ActiveRoomBanner />
              {notice && (
                <p className={noticeBase} role="status">
                  {notice}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3 pt-3">
                <button
                  className={cn(
                    primaryBase,
                    'h-[58px] px-[34px] text-[17px]',
                    game.live
                      ? 'bg-landing-accent text-landing-accent-ink'
                      : 'bg-landing-well text-landing-text-strong shadow-landing-cta',
                  )}
                  onClick={handlePrimary}
                  type="button"
                >
                  {primaryLabel}
                </button>
                <LandingRoomCodeForm
                  code={code}
                  layout="wide"
                  onCodeChange={setCode}
                  onSubmit={handleJoin}
                />
              </div>
              <p className={cn(hintBase, 'max-w-[44ch] text-[12.5px]/[1.5]')} id="code-help">
                {hint}
              </p>
            </div>

            <LandingGameList
              activeIndex={activeIndex}
              games={landingGames}
              onSelect={handleSelect}
            />
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="relative h-svh w-full overflow-hidden [background:var(--ds-landing-bg-narrow)]">
      <a className={cn(skipLinkBase, 'focus:top-4 focus:left-4')} href="#room-code">
        방 코드 입력으로 바로가기
      </a>

      {/* 3D는 상단 영역만 차지한다. 바텀시트 아래로 내려가면 텍스트 대비를 보장할 수 없다. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 bottom-[42%] z-1"
      >
        <HeroCanvas game={game.key} />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-3 flex items-center justify-between gap-3 px-5 pt-[max(18px,env(safe-area-inset-top))]">
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-[19px]/none font-bold tracking-[-0.03em] text-landing-text">
            YO<span className="text-landing-accent">R</span>R
          </span>
          <span className="font-mono text-[9px]/none font-bold tracking-[0.22em] text-landing-text-muted uppercase">
            Arcade
          </span>
        </span>
        <span className="text-[11px]/none font-landing-bold tracking-[0.02em] text-landing-text-secondary">
          2~6인 · 5분
        </span>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-4 flex flex-col gap-3.5 rounded-t-3xl bg-landing-sheet pt-4 pb-[max(18px,env(safe-area-inset-bottom))] shadow-landing-sheet">
        <LandingGameRail activeIndex={activeIndex} games={landingGames} onSelect={handleSelect} />

        <div
          aria-labelledby={landingTabId(game.key)}
          className="flex flex-col items-start gap-[9px] px-5"
          id={LANDING_PANEL_ID}
          role="tabpanel"
        >
          <LandingHeroCopy game={game} layout="narrow" />
        </div>

        <div className="flex flex-col gap-2.5 px-5 pt-0.5">
          <ActiveRoomBanner />
          {notice && (
            <p className={cn(noticeBase, 'text-center')} role="status">
              {notice}
            </p>
          )}
          <button
            className={cn(
              primaryBase,
              'h-14 w-full text-[17px]',
              game.live
                ? 'bg-landing-accent text-landing-accent-ink'
                : 'bg-landing-soft-strong text-landing-text-strong shadow-landing-cta-sheet',
            )}
            onClick={handlePrimary}
            type="button"
          >
            {primaryLabel}
          </button>
          <LandingRoomCodeForm
            code={code}
            layout="narrow"
            onCodeChange={setCode}
            onSubmit={handleJoin}
          />
          <p className={cn(hintBase, 'text-center text-[12px]/[1.5]')} id="code-help">
            {hint}
          </p>
        </div>
      </div>
    </main>
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
        'flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border px-4 py-3',
        needsResume
          ? 'border-landing-accent/45 bg-landing-accent-tint shadow-landing-panel'
          : 'border-transparent bg-landing-well',
      )}
    >
      <p className="m-0 min-w-0 text-[13px]/[1.4] font-landing-medium text-landing-text-strong">
        <strong className="block font-landing-bold">
          {needsResume ? '진행 중인 방이 있어요' : `${roomSession.roomCode} 방에 참여 중이에요`}
        </strong>
        {needsResume && (
          <span className="text-landing-text-secondary">
            {roomSession.roomCode} · {roomSession.nickname}
          </span>
        )}
      </p>
      <div className="flex flex-none items-center gap-2">
        <button
          className="cursor-pointer rounded-full border-0 bg-landing-accent px-4 py-2 text-[13px] font-landing-bold text-landing-accent-ink focus-visible:outline-3 focus-visible:outline-white focus-visible:outline-offset-2"
          onClick={handleReturn}
          type="button"
        >
          {needsResume ? returnLabel : '돌아가기'}
        </button>
        <button
          className="cursor-pointer rounded-full border-0 bg-transparent px-2 py-2 text-[13px] font-landing-bold text-landing-text-secondary underline-offset-2 hover:underline focus-visible:outline-3 focus-visible:outline-white focus-visible:outline-offset-2 disabled:opacity-60"
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
