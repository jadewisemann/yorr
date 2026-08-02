import { cn } from '@/cn'
import { LANDING_SHARED_META, type LandingGame } from '@/landingGames'
import { HeroCanvas } from './HeroCanvas'

interface LandingHeroCardProps {
  game: LandingGame
  /** wide = 데스크톱 대형 카드, narrow = 모바일 카드. 메타 필 위치가 갈린다. */
  layout: 'narrow' | 'wide'
}

/**
 * 캐러셀 가운데에 서는 선택된 게임 카드. 3D 히어로가 카드 안을 채우고, 아래 절반을
 * 그라디언트로 덮은 뒤 그 위에 카피를 얹는다 — 3D 위에 글자를 직접 놓으면 대비를 보장할 수 없다.
 */
export function LandingHeroCard({ game, layout }: LandingHeroCardProps) {
  const wide = layout === 'wide'

  return (
    <div
      className={cn(
        'relative h-full w-full overflow-hidden border [background:var(--ds-landing-card)]',
        wide ? 'rounded-[30px]' : 'rounded-[26px]',
        game.live
          ? 'border-landing-accent/42 shadow-landing-card'
          : 'border-landing-hairline-strong shadow-landing-card-quiet',
      )}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <HeroCanvas game={game.key} />
      </div>
      {/* 카드 안쪽 광택과 위에서 떨어지는 스포트라이트. 순서대로 겹쳐야 아래가 잠긴다. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 shadow-landing-card-inset"
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute left-1/2 -translate-x-1/2 [background:var(--ds-landing-card-glow)]',
          wide ? '-top-30 h-90 w-160' : '-top-17 h-55 w-75',
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 [background:var(--ds-landing-card-scrim)]',
          wide ? 'h-[53%]' : 'h-[48%]',
        )}
      />
      {game.live && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] [background:var(--ds-landing-accent-line)]"
        />
      )}

      <div
        className={cn(
          'absolute flex flex-col items-start',
          wide ? 'bottom-9 left-11 max-w-155 gap-3.5' : 'inset-x-5 bottom-5.5 gap-2.5',
        )}
      >
        <span
          className={cn(
            'inline-flex items-center gap-2.5 rounded-full border font-mono font-bold tracking-[0.16em]',
            wide ? 'h-8.5 px-3.5 text-[12px]/none' : 'h-7.5 px-3 text-[11px]/none',
            game.live
              ? 'border-landing-accent/50 bg-landing-accent-tint text-landing-accent-text'
              : 'border-landing-hairline-strong bg-landing-soft text-landing-text-muted',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-2 bg-current',
              game.live
                ? 'rounded-full shadow-[0_0_10px_currentColor] motion-safe:animate-ring-pulse'
                : 'rounded-[2px]',
            )}
          />
          {game.live ? 'PLAYABLE NOW' : 'COMING SOON'}
        </span>
        <h1
          className={cn(
            'm-0 font-bold tracking-[-0.035em] text-landing-text',
            wide ? 'text-[clamp(40px,4.6vw,66px)]/none' : 'text-[clamp(30px,9.4vw,38px)]/[1.05]',
          )}
        >
          {game.name}
        </h1>
        <p
          className={cn(
            'm-0 font-semibold text-landing-text-strong',
            wide ? 'text-[clamp(16px,1.6vw,22px)]/[1.3]' : 'text-[15px]/[1.35]',
          )}
        >
          {game.tagline}
        </p>
        {/* 규칙 한 줄 설명은 데스크톱 카드에만 — 모바일 카드는 배지·제목·한 줄 카피까지가
            들어갈 수 있는 분량이고, 메타 필이 카드 밖에서 나머지를 말한다. */}
        {wide && (
          <p className="m-0 font-landing-medium text-pretty text-[clamp(13px,1.15vw,16px)]/[1.45] text-landing-text-muted">
            {game.description}
          </p>
        )}
      </div>

      {/* 메타 필은 양쪽 다 카드 안에 선다 — 데스크톱은 우측 하단 세로, 모바일은 상단 가로.
          모바일 카드는 텍스트가 전부 아래에 붙어 있어 위가 비고, 카드 밖에 두면 세로로
          100px 가까이 먹어 h-svh 안에서 하단 CTA를 밀어낸다. */}
      {wide ? (
        <div className="absolute right-10 bottom-9 flex flex-col items-end gap-2.5">
          <LandingMetaPills game={game} layout="wide" />
        </div>
      ) : (
        <div className="absolute inset-x-5 top-5 flex flex-wrap gap-1.5">
          <LandingMetaPills game={game} layout="narrow" />
        </div>
      )}
    </div>
  )
}

interface LandingMetaPillsProps {
  game: LandingGame
  layout: 'narrow' | 'wide'
}

/** 인원 · 소요 시간 · 조작 · 멀티플레이 네 칸. 첫 칸만 mono 대문자 배지다. */
export function LandingMetaPills({ game, layout }: LandingMetaPillsProps) {
  const wide = layout === 'wide'
  const pillBase = cn(
    'inline-flex flex-none items-center rounded-full border whitespace-nowrap',
    wide ? 'h-8.5 px-3.5 text-[14px]' : 'h-8 px-3 text-[13px]',
  )

  return (
    <>
      <span
        className={cn(
          pillBase,
          'font-mono font-bold tracking-[0.12em]',
          wide ? 'text-[12px]' : 'text-[11px]',
          game.live
            ? 'border-landing-accent/45 bg-landing-accent-tint text-landing-accent-text'
            : 'border-landing-hairline-strong bg-landing-well text-landing-text-strong',
        )}
      >
        {game.players}
      </span>
      {[game.duration, game.control, LANDING_SHARED_META].map((label) => (
        <span
          className={cn(
            pillBase,
            'border-landing-hairline-strong bg-landing-well font-semibold text-landing-text-strong',
          )}
          key={label}
        >
          {label}
        </span>
      ))}
    </>
  )
}
