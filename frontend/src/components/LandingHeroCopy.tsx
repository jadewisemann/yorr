import { cn } from '@/cn'
import { gameMeta, type LandingGame } from '@/landingGames'

interface LandingHeroCopyProps {
  game: LandingGame
  /** wide = 데스크톱 히어로, narrow = 모바일 바텀시트. */
  layout: 'narrow' | 'wide'
}

/** 선택된 게임의 상태 배지 · 제목 · 메타 한 묶음. 두 레이아웃이 크기만 다르다. */
export function LandingHeroCopy({ game, layout }: LandingHeroCopyProps) {
  const wide = layout === 'wide'

  return (
    <>
      <span
        className={cn(
          'inline-flex items-center rounded-full font-landing-bold tracking-[0.02em]',
          wide ? 'h-[30px] px-3.5 text-[12px]/none' : 'h-7 px-[13px] text-[11.5px]/none',
          // 디자인 01 PLAYABLE NOW — 레드는 CTA 전용이라 상태 배지는 그린 틴트를 쓴다.
          game.live
            ? 'border border-positive/36 bg-positive/12 text-positive'
            : 'bg-landing-badge text-landing-badge-text shadow-landing-badge',
        )}
      >
        {game.live ? '지금 플레이 가능' : '준비 중'}
      </span>
      <h1
        className={cn(
          'm-0 font-bold text-landing-text',
          wide
            ? 'text-[clamp(44px,6.4vw,96px)]/[0.98] tracking-[-0.05em] text-balance'
            : 'text-[clamp(34px,10.5vw,46px)]/[1.02] tracking-[-0.04em]',
        )}
      >
        {game.name}
      </h1>
      <p
        className={cn(
          'm-0 font-semibold tracking-[0.01em] text-landing-text-secondary',
          wide ? 'text-[clamp(13px,1.4vw,17px)]/[1.4]' : 'text-[13.5px]/[1.4]',
        )}
      >
        {gameMeta(game)}
      </p>
    </>
  )
}
