import type { GameKey } from '@/games'
import { cn } from '@/shared/cn'
import { HeroCanvas } from './HeroCanvas'

interface LandingHeroProps {
  /** 3D 연출로 세울 게임. 마지막으로 고른 게임을 이어받아 BGM과 씬이 어긋나지 않는다. */
  game: GameKey
  layout: 'narrow' | 'wide'
  /** 카드 목록 뷰로 넘어가는 유일한 진입. */
  onPlay: () => void
}

/**
 * 히어로는 더 이상 게임을 고르는 곳이 아니다(S15P11A406-213). 플레이 버튼 하나만 세우고,
 * 고르는 일은 카드 목록 뷰(LandingGameList)가 맡는다 — 첫 화면의 선택지는 "시작한다"
 * 하나여야 하고, 다섯 게임의 비교는 목록이 더 잘한다. 3D는 브랜드 연출로 남는다.
 */
export function LandingHero({ game, layout, onPlay }: LandingHeroProps) {
  const wide = layout === 'wide'

  return (
    <div
      className={cn(
        'relative h-full w-full overflow-hidden border border-landing-accent/42 shadow-landing-card [background:var(--ds-landing-card)]',
        wide ? 'rounded-[30px]' : 'rounded-[26px]',
      )}
    >
      <HeroCanvas game={game} />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 shadow-landing-card-inset"
      />
      {/* CTA가 3D 피사체 위에 서므로 바닥만 살짝 잠근다 — 카드 시절 스크림과 같은 토큰. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[30%] [background:var(--ds-landing-card-scrim)]"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] [background:var(--ds-landing-accent-line)]"
      />

      <div className="absolute inset-x-0 bottom-0 flex justify-center px-5 pb-[clamp(18px,8%,44px)]">
        <button
          className={cn(
            'flex cursor-pointer items-center justify-center gap-3.5 rounded-[20px] border-0 bg-landing-accent font-bold text-landing-accent-ink transition-colors duration-150 ease-out focus-visible:outline-3 focus-visible:outline-white focus-visible:outline-offset-3',
            wide
              ? 'h-18 shrink-0 px-16 text-[23px] shadow-landing-cta'
              : 'h-15 w-full text-[19px] shadow-landing-cta-sheet',
          )}
          onClick={onPlay}
          type="button"
        >
          <span
            aria-hidden="true"
            className="size-0 border-y-[10px] border-l-[16px] border-y-transparent border-l-current"
          />
          플레이
        </button>
      </div>
    </div>
  )
}
