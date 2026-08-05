import { motion, useAnimationControls, useReducedMotion } from 'motion/react'
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type WheelEvent,
} from 'react'
import type { Game } from '@/games'
import { LANDING_PANEL_ID, landingTabId } from '@/landing/landingTabs'
import { cn } from '@/shared/cn'
import { ENTER } from '@/shared/motion'
import { LandingHeroCard } from './LandingHeroCard'

interface LandingHeroCarouselProps {
  activeIndex: number
  games: Game[]
  /** wide = 좌우 화살표까지 있는 데스크톱, narrow = 스와이프만 있는 모바일. */
  layout: 'narrow' | 'wide'
  /** 활성 카드 안 파티 모드 CTA. 플레이와 같은 액션 클러스터에 선다. */
  onPartyMode: () => void
  /** 활성 카드 안 플레이 CTA. 카드가 소유하지만 어디로 갈지는 화면이 정한다. */
  onPlay: () => void
  onSelect: (index: number) => void
  /** 활성 카드 안 연습 모드 입구. 플레이 바로 위에 선다. */
  onTutorial: () => void
}

/** 이 거리 이상 끌고 놓으면 옆 게임으로 넘어간다. 그 아래는 가운데로 스냅된다. */
const STEP_DISTANCE_PX = { narrow: 42, wide: 64 }
/**
 * 이 거리를 넘긴 뒤에야 "끄는 중"으로 승격한다. 그 전에는 띠를 1px도 움직이지 않고
 * 포인터도 캡처하지 않는다 — 카드 안 플레이 CTA 위에서 시작한 탭이 손가락 흔들림 몇 px에
 * 드래그로 뒤집히면 버튼을 영영 못 누른다. 브라우저 터치 슬롭과 같은 8px.
 */
const DRAG_ACTIVATION_PX = 8
/** 끌리는 거리 자체는 여기서 멈춘다 — 카드가 화면 밖까지 따라 나가지 않게 한다. */
const DRAG_LIMIT_PX = 140
/** 휠 한 번에 한 칸만 움직이도록 두는 최소 간격. 트랙패드는 한 제스처가 수십 번 발화한다. */
const WHEEL_COOLDOWN_MS = 340
const WHEEL_THRESHOLD = 18
/**
 * 칸을 넘길 때 띠가 미끄러지는 거리(컨테이너 폭 대비 %). 인접한 두 카드의 **중심 사이
 * 거리**다 — 이만큼 움직여야 새 카드가 직전에 이웃 카드가 서 있던 자리에서 들어온 것처럼
 * 보인다. 가운데 카드가 중심 50%에 서므로 값을 정하는 것은 <b>이웃 카드 좌표뿐</b>이다
 * (narrow -15.6%+24.6% → 중심 -3.3%, wide 0%+13.5% → 중심 6.75%). 가운데 카드의 좌우
 * 여백을 바꿔도 이 값은 그대로지만, 이웃 좌표를 바꾸면 여기도 같이 고친다.
 */
const SLIDE_DISTANCE_PCT = { narrow: 53.3, wide: 43.25 }

export function LandingHeroCarousel({
  activeIndex,
  games,
  layout,
  onPartyMode,
  onPlay,
  onSelect,
  onTutorial,
}: LandingHeroCarouselProps) {
  const wide = layout === 'wide'
  const [dragOffset, setDragOffset] = useState(0)
  const dragStartRef = useRef<number | null>(null)
  /** 이번 제스처가 임계값을 넘겨 드래그로 승격했는지. 뒤따르는 click을 삼킬지의 근거다. */
  const draggedRef = useRef(false)
  const lastWheelRef = useRef(0)
  const track = useAnimationControls()
  const reduceMotion = useReducedMotion()
  const previousIndexRef = useRef(activeIndex)

  const game = games[activeIndex]
  /** 끝에서도 이웃이 있다 — 목록이 순환하므로 양옆 카드가 비지 않는다. */
  const previousIndex = (activeIndex - 1 + games.length) % games.length
  const nextIndex = (activeIndex + 1) % games.length
  const previous = games[previousIndex]
  const next = games[nextIndex]

  /**
   * 칸이 바뀌면 띠를 이웃 카드가 있던 자리에서 밀어 넣는다. 화살표·스와이프·휠뿐 아니라
   * 진행 표시줄의 점을 눌러 바뀐 경우도 여기서 잡는다 — 어느 경로로 바뀌었는지가 아니라
   * "인덱스가 바뀌었다"가 트리거다.
   *
   * layout effect인 이유: 새 내용이 그려진 프레임에 출발 위치를 함께 써야 한다. 한 프레임
   * 늦으면 가운데 선 새 카드가 보였다가 옆으로 튕겨 나갔다 돌아온다.
   */
  useLayoutEffect(() => {
    const from = previousIndexRef.current
    previousIndexRef.current = activeIndex
    if (from === activeIndex) return
    // 드래그로 넘어온 경우 x가 손가락 위치에 남아 있다 — 어느 쪽이든 0으로 정리한다.
    if (reduceMotion) {
      track.set({ x: 0 })
      return
    }
    // 점을 눌러 두 칸 이상 건너뛰어도 화면에는 카드 세 장뿐이다. 한 칸 거리로 고정한다.
    const direction = Math.sign(circularDelta(from, activeIndex, games.length))
    track.set({ x: `${direction * SLIDE_DISTANCE_PCT[layout]}%` })
    void track.start({ x: 0, transition: ENTER })
  }, [activeIndex, games.length, layout, reduceMotion, track])

  /** 목록 끝에서 반대편으로 감싼다(점 목록 방향키와 같은 규칙). */
  const step = (delta: number) => {
    const target = (activeIndex + delta + games.length) % games.length
    if (target !== activeIndex) onSelect(target)
  }
  // 문서 리스너가 매 렌더 붙었다 떨어지지 않도록 ref로 읽는다.
  const stepRef = useRef(step)
  stepRef.current = step

  /**
   * 방향키는 <b>문서에서</b> 듣는다. 예전에는 아래 `<section>`의 onKeyDown이었는데,
   * section은 tabIndex가 없어 포커스를 받을 일이 없었다 — 진입 직후 포커스는 body에 있고
   * Tab을 누르면 헤더가 먼저 잡히므로, 방향키를 눌러도 아무 일도 일어나지 않았다.
   * (내비에 시멘틱 태그를 다는 것과는 무관한 문제다. 랜드마크가 아니라 포커스가 원인이다.)
   *
   * 무엇을 거르는지는 {@link keyboardStep}에 있다.
   */
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const delta = keyboardStep(event)
      if (delta === 0) return
      event.preventDefault()
      stepRef.current(delta)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    // 가로 스크롤(트랙패드 두 손가락)이 있으면 그 축을 쓰고, 없으면 세로 휠을 칸 이동으로 읽는다.
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (Math.abs(delta) < WHEEL_THRESHOLD) return
    const now = event.timeStamp
    if (now - lastWheelRef.current < WHEEL_COOLDOWN_MS) return
    lastWheelRef.current = now
    step(delta > 0 ? 1 : -1)
  }

  /**
   * 카드 안에 플레이 CTA가 들어오면서 규칙이 바뀌었다. 예전에는 `closest('button')`이면
   * 드래그를 아예 시작하지 않았는데, 그 규칙을 두면 카드 폭을 꽉 채운 CTA 위에서 스와이프가
   * 죽는다 — 모바일에서 엄지가 가장 먼저 닿는 자리다.
   * <p>
   * 대신 <b>임계값으로 가른다</b>: 8px을 넘기기 전에는 아무 일도 없고, 넘긴 뒤에야 포인터를
   * 캡처한다. pointerdown에서 캡처하면 안 된다 — 캡처가 걸린 순간부터 호환 마우스 이벤트가
   * 이 섹션으로 재타깃돼 카드 안 버튼의 click이 <b>아예 발화하지 않는다.</b>
   */
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // 보조 버튼(우클릭·가운데)은 드래그가 아니다.
    if (event.button !== 0) return
    dragStartRef.current = event.clientX
    draggedRef.current = false
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current === null) return
    // 승격 전에는 캡처가 없다 — 영역 밖에서 손을 떼면 pointerup이 여기로 오지 않아
    // dragStartRef가 남고, 그 뒤 단순 hover가 카드를 끌어버린다. 여기서 정리한다.
    if (event.buttons === 0) {
      handlePointerUp()
      return
    }

    const raw = event.clientX - dragStartRef.current
    if (!draggedRef.current) {
      if (Math.abs(raw) < DRAG_ACTIVATION_PX) return
      draggedRef.current = true
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    // 목록이 순환하므로 양 끝에서도 저항을 주지 않는다 — 어느 방향으로든 갈 곳이 있다.
    const offset = Math.max(-DRAG_LIMIT_PX, Math.min(DRAG_LIMIT_PX, raw))
    setDragOffset(offset)
    // 끌리는 동안은 손가락을 그대로 따라간다 — 애니메이션이 아니라 즉시 반영이다.
    track.set({ x: offset })
  }

  const handlePointerUp = () => {
    if (dragStartRef.current === null) return
    dragStartRef.current = null
    // 임계값을 못 넘긴 탭. 띠는 움직인 적이 없으므로 되돌릴 것도 없다 —
    // 그대로 두면 카드 안 CTA의 click이 정상으로 이어진다.
    if (!draggedRef.current) return

    const travelled = dragOffset
    setDragOffset(0)
    if (Math.abs(travelled) < STEP_DISTANCE_PX[layout]) {
      // 문턱을 못 넘었으면 제자리로 되돌린다. 칸이 바뀌는 경우는 위 layout effect가 맡는다.
      void track.start({ x: 0, transition: ENTER })
      return
    }
    step(travelled > 0 ? -1 : 1)
  }

  /**
   * 드래그로 끝난 제스처 뒤에 따라오는 click을 캡처 단계에서 삼킨다. CTA 위에서 스와이프를
   * 시작했다가 손을 떼는 순간 게임이 시작되면 안 된다. 캡처 단계라 버튼 자신의 onClick보다
   * 먼저 돌아 여기서 끊긴다. detail === 0은 키보드가 만든 click이라 통과시킨다.
   */
  const handleClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!draggedRef.current || event.detail === 0) return
    draggedRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

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
      <motion.div animate={track} className="absolute inset-0" initial={false}>
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
          <LandingHeroCard
            game={game}
            layout={layout}
            onPartyMode={onPartyMode}
            onPlay={onPlay}
            onTutorial={onTutorial}
          />

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
 * 이 키 입력이 캐러셀을 몇 칸 움직여야 하는가(아니면 0). 거르는 것은 둘이다.
 *
 * - `defaultPrevented` — 진행 표시줄 tablist가 이미 처리한 키다. 안 거르면 한 번 눌러
 *   두 칸 넘어간다.
 * - 입력 요소·열린 다이얼로그 안에서 난 키 — 코드를 타이핑하는 동안 뒤에서 캐러셀이
 *   같이 미끄러지면 안 된다.
 */
function keyboardStep(event: globalThis.KeyboardEvent) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return 0
  const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
  if (delta === 0) return 0
  const target = event.target as HTMLElement | null
  const guarded = target?.closest('input, textarea, select, [contenteditable], [aria-modal="true"]')
  return guarded ? 0 : delta
}

/**
 * 순환 목록에서 두 인덱스 사이의 최단 이동. 5개짜리 목록에서 4→0은 +4가 아니라 -1이다 —
 * 목록이 감싸므로 화면에서는 오른쪽 끝에서 왼쪽으로 한 칸 간 것으로 보여야 한다.
 */
function circularDelta(from: number, to: number, length: number) {
  const raw = to - from
  if (raw > length / 2) return raw - length
  if (raw < -length / 2) return raw + length
  return raw
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
      ? 'top-[7.2%] h-[85.6%] w-[13.5%] rounded-[26px]'
      : 'pointer-events-none top-[6%] h-[88%] w-[24.6%] rounded-[24px] opacity-40',
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
        'cursor-pointer p-0 opacity-65 transition-opacity duration-150 ease-out hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2',
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
        'absolute top-1/2 z-1 grid size-tap -translate-y-1/2 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-landing-text-muted transition-colors duration-150 ease-out hover:text-landing-text focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2',
        // 카드 안쪽 가장자리에 붙는다 — 카드의 일부로 읽히고 띠와 함께 움직인다.
        wide ? 'right-2 left-2' : 'right-0.5 left-0.5',
        isNext ? 'left-auto' : 'right-auto',
      )}
      onClick={onClick}
      type="button"
    >
      {/* 직각 모서리를 45° 돌린 꺾쇠. 세로로 늘여 '›' 글리프보다 각을 세운다 —
          3D 위에 얹히므로 형태가 뚜렷할수록 읽힌다. */}
      <span
        aria-hidden="true"
        className={cn(
          'rotate-45 scale-y-135 border-current',
          wide ? 'size-3.5 border-t-2 border-r-2' : 'size-3 border-t-2 border-r-2',
          isNext ? undefined : 'rotate-[225deg]',
        )}
      />
    </button>
  )
}
