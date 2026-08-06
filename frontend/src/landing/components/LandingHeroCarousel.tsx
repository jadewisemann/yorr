import { motion } from 'motion/react'
import type { Game } from '@/games'
import { LANDING_PANEL_ID, landingTabId } from '@/landing/landingTabs'
import { useHeroCarousel } from '@/landing/model/useHeroCarousel'
import { cn } from '@/shared/cn'
import { LandingHeroCard } from './LandingHeroCard'

interface LandingHeroCarouselProps {
  activeIndex: number
  games: Game[]
  /** wide = 좌우 화살표까지 있는 데스크톱, narrow = 스와이프만 있는 모바일. */
  layout: 'narrow' | 'wide'
  /** 활성 카드 안 플레이 CTA. 카드가 소유하지만 어디로 갈지는 화면이 정한다. */
  onPlay: () => void
  onSelect: (index: number) => void
}

export function LandingHeroCarousel({
  activeIndex,
  games,
  layout,
  onPlay,
  onSelect,
}: LandingHeroCarouselProps) {
  const {
    game,
    handleClickCapture,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    next,
    nextIndex,
    previous,
    previousIndex,
    step,
    trackX,
    wide,
  } = useHeroCarousel({ activeIndex, games, layout, onSelect })

  if (!game) return null

  return (
    // 드래그·휠은 화살표·점 목록 위에 얹는 편의 조작이라 이 영역 자체는 조작 위젯이 아니다 —
    // 이름 있는 region으로 감싸기만 한다. 키보드·스크린리더의 진입점은 LandingProgress의 tablist다.
    <section
      aria-label="게임 캐러셀"
      className="relative h-full w-full touch-none select-none"
      onClickCapture={handleClickCapture}
      onPointerCancel={handlePointerUp}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
    >
      {/* 띠 전체를 한 덩어리로 움직인다 — 카드 세 장을 각각 애니메이션하면 이웃 카드가
          제 위치를 벗어나고, 퇴장 카드를 따로 그리면 3D 히어로가 두 벌 살아난다. */}
      <motion.div className="absolute inset-0" style={{ x: trackX }}>
        {previous && (
          <NeighborCard
            game={previous}
            layout={layout}
            onSelect={wide ? () => onSelect(previousIndex) : null}
            side="left"
          />
        )}
        {next && (
          <NeighborCard
            game={next}
            layout={layout}
            onSelect={wide ? () => onSelect(nextIndex) : null}
            side="right"
          />
        )}
        <div
          aria-labelledby={landingTabId(game.key)}
          className={cn(
            'absolute inset-y-0',
            // narrow는 헤더·카피와 같은 20px 거터에 선다(px-5). 예전 9%는 뷰포트마다
            // 값이 달라(390에서 35px) 카드 왼쪽 모서리가 상단 워드마크와 다른 세로선에
            // 섰다. 고정 20px로 두면 화면 폭과 무관하게 한 줄로 읽힌다.
            // 이웃 카드가 내보이는 폭은 그만큼(35 → 20px) 줄지만, 띠가 미끄러지는 거리
            // (SLIDE_DISTANCE_PCT)는 peek 좌표로 정해지므로 그대로다.
            wide ? 'left-1/2 w-[69.4%] -translate-x-1/2' : 'inset-x-5',
          )}
          id={LANDING_PANEL_ID}
          role="tabpanel"
        >
          <LandingHeroCard game={game} layout={layout} onPlay={onPlay} />

          {/* 화살표는 카드 안쪽 가장자리에 붙여 <b>띠와 함께 움직인다</b>. 바깥 고정 좌표에
              두면 카드가 미끄러지는 동안 버튼만 제자리에 멈춰 있어 화면에서 홀로 떠 보였고,
              넓은 화면에서는 카드에서 수백 px 떨어져 무엇을 넘기는 버튼인지도 흐려졌다.
              순환하므로 끝에서도 비활성이 없다. 모바일에도 둔다 — 스와이프는 발견 가능한
              조작이 아니고, 진행 표시줄 탭은 44px 세로만 확보돼 정밀 조준이 필요하다. */}
          <ArrowButton direction="previous" layout={layout} onClick={() => step(-1)} />
          <ArrowButton direction="next" layout={layout} onClick={() => step(1)} />
        </div>
      </motion.div>
    </section>
  )
}

/**
 * 양옆에 서는 이웃 카드. 두 레이아웃이 하는 일이 다르다.
 * <p>
 * <b>wide</b>는 띠 <b>안쪽</b>에 온전히 선다(예전엔 -12.2%로 걸쳐 있어 화면 밖으로 잘려
 * 나갔다). 카드 석 장이 한 화면에 함께 보이고, 이웃 카드를 눌러 바로 그 게임으로 넘어간다.
 * 가운데 카드 폭(69.4%)은 건드리지 않는다 — 760px에서 이미 하단 띠의 태그라인 칸이 83px뿐이라
 * 여기서 더 좁히면 액션 클러스터에 밀려 글자가 깨진다({@link LandingHeroCard} 하단 띠 주석).
 * 그래서 이웃은 남는 갓길(양쪽 15.3%)에 들어간다.
 * <p>
 * <b>narrow</b>는 종전 그대로 "옆에 더 있다"만 말하는 장식이다. 390px에서 내보일 수 있는
 * 폭이 35px이라 탭 타깃이 되지 못하고, 포인터를 받으면 스와이프와 다툰다.
 * <p>
 * 3D는 가운데 카드만 그린다 — 이웃은 {@link LandingHeroCard}가 아니라 이 정적 판이므로
 * 카드가 셋 보여도 살아 있는 HeroCanvas는 여전히 하나다.
 */
function NeighborCard({
  game,
  layout,
  onSelect,
  side,
}: {
  game: Game
  layout: 'narrow' | 'wide'
  /** 눌러 고를 수 있는가. null이면 장식(narrow)이다. */
  onSelect: (() => void) | null
  side: 'left' | 'right'
}) {
  const wide = layout === 'wide'
  const shell = cn(
    'absolute overflow-hidden border border-landing-hairline [background:var(--ds-landing-ghost)]',
    // narrow 퍼센트는 레퍼런스 좌표(390×436)를 그대로 옮긴 값이다. wide는 가운데 카드가
    // 비워 둔 갓길(0 ~ 15.3%) 안에서 13.5%를 쓰고 나머지 1.8%가 카드 사이 틈이 된다.
    wide
      ? 'top-[7.2%] h-[85.6%] w-[13.5%] rounded-sheet'
      : 'pointer-events-none top-[6%] h-[88%] w-[24.6%] rounded-sheet opacity-40',
    wide
      ? side === 'left'
        ? 'left-0'
        : 'right-0'
      : side === 'left'
        ? 'left-[-15.6%]'
        : 'right-[-15.6%]',
  )

  if (!onSelect) return <div aria-hidden="true" className={shell} />

  return (
    <button
      aria-label={`${game.name} 선택`}
      className={cn(
        shell,
        // 가운데 카드보다 뒤로 물러나 있어야 무엇이 선택된 카드인지 읽힌다. 다만 눌리는
        // 물건이므로 예전 장식 시절(0.34)만큼 어둡게 두지는 않는다.
        'cursor-pointer p-0 opacity-65 transition-opacity duration-150 ease-out hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2 pressable',
      )}
      onClick={onSelect}
      type="button"
    >
      {/* 갓길 카드는 1600px 띠에서도 216px이라 이름 한 줄이 전부다. 인원·시간은 고른 뒤
          가운데 카드의 메타 필이 말한다. */}
      <span
        className={cn(
          'absolute inset-x-3.5 bottom-5 block text-balance text-left text-[clamp(13px,1.15vw,20px)]/[1.2] font-bold',
          game.live ? 'text-landing-text' : 'text-landing-text-muted',
        )}
      >
        {game.name}
      </span>
    </button>
  )
}

function ArrowButton({
  direction,
  layout,
  onClick,
}: {
  direction: 'next' | 'previous'
  layout: 'narrow' | 'wide'
  onClick: () => void
}) {
  const isNext = direction === 'next'
  const wide = layout === 'wide'

  return (
    <button
      aria-label={isNext ? '다음 게임' : '이전 게임'}
      className={cn(
        // 원형 판을 걷었다 — 카드 안에 들어온 뒤로는 그 테두리가 카드 위에 뜬 별개
        // 위젯처럼 보였다. 꺾쇠만 남기면 카드에 얹힌 표식으로 읽힌다. 탭 타깃(44px)은
        // 투명한 히트 영역으로 그대로 지킨다.
        'absolute top-1/2 z-1 grid size-tap aspect-square -translate-y-1/2 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-landing-text-muted transition-colors duration-150 ease-out hover:text-landing-text focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2 pressable',
        // 카드 안쪽 가장자리에 붙는다 — 카드의 일부로 읽히고 띠와 함께 움직인다.
        isNext ? (wide ? 'right-2' : 'right-0.5') : wide ? 'left-2' : 'left-0.5',
      )}
      onClick={onClick}
      type="button"
    >
      {/* 직각 모서리를 45° 돌린 꺾쇠. 세로로 늘여 '›' 글리프보다 각을 세운다 —
          3D 위에 얹히므로 형태가 뚜렷할수록 읽힌다. */}
      <span
        aria-hidden="true"
        className={cn(
          'rotate-45 border-current',
          wide ? 'size-3.5 border-t-2 border-r-2' : 'size-3 border-t-2 border-r-2',
          isNext ? undefined : 'rotate-[225deg]',
        )}
      />
    </button>
  )
}
