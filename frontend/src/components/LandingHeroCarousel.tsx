import { motion, useAnimationControls, useReducedMotion } from 'motion/react'
import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useRef,
  useState,
  type WheelEvent,
} from 'react'
import { cn } from '@/cn'
import { LANDING_PANEL_ID, type LandingGame, landingTabId } from '@/landingGames'
import { ENTER } from '@/motion'
import { LandingHeroCard } from './LandingHeroCard'

interface LandingHeroCarouselProps {
  activeIndex: number
  games: LandingGame[]
  /** wide = 좌우 화살표까지 있는 데스크톱, narrow = 스와이프만 있는 모바일. */
  layout: 'narrow' | 'wide'
  onSelect: (index: number) => void
}

/** 이 거리 이상 끌고 놓으면 옆 게임으로 넘어간다. 그 아래는 가운데로 스냅된다. */
const STEP_DISTANCE_PX = { narrow: 42, wide: 64 }
/** 끌리는 거리 자체는 여기서 멈춘다 — 카드가 화면 밖까지 따라 나가지 않게 한다. */
const DRAG_LIMIT_PX = 140
/** 휠 한 번에 한 칸만 움직이도록 두는 최소 간격. 트랙패드는 한 제스처가 수십 번 발화한다. */
const WHEEL_COOLDOWN_MS = 340
const WHEEL_THRESHOLD = 18
/**
 * 칸을 넘길 때 띠가 미끄러지는 거리(컨테이너 폭 대비 %). 인접한 두 카드의 **중심 사이
 * 거리**다 — 이만큼 움직여야 새 카드가 직전에 이웃 카드가 서 있던 자리에서 들어온 것처럼
 * 보인다. 아래 카드 좌표(narrow inset-x-6.7% / peek -14.9%+24.6%, wide 50%±34.7% /
 * peek -12.2%+36.1%)에서 계산한 값이라 그 좌표를 바꾸면 여기도 같이 고친다.
 */
const SLIDE_DISTANCE_PCT = { narrow: 52.6, wide: 44.15 }

export function LandingHeroCarousel({
  activeIndex,
  games,
  layout,
  onSelect,
}: LandingHeroCarouselProps) {
  const wide = layout === 'wide'
  const [dragOffset, setDragOffset] = useState(0)
  const dragStartRef = useRef<number | null>(null)
  const lastWheelRef = useRef(0)
  const track = useAnimationControls()
  const reduceMotion = useReducedMotion()
  const previousIndexRef = useRef(activeIndex)

  const game = games[activeIndex]
  /** 끝에서도 이웃이 있다 — 목록이 순환하므로 양옆 미리보기가 비지 않는다. */
  const previous = games[(activeIndex - 1 + games.length) % games.length]
  const next = games[(activeIndex + 1) % games.length]

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

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') step(-1)
    else if (event.key === 'ArrowRight') step(1)
    else return
    event.preventDefault()
  }

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    // 가로 스크롤(트랙패드 두 손가락)이 있으면 그 축을 쓰고, 없으면 세로 휠을 칸 이동으로 읽는다.
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (Math.abs(delta) < WHEEL_THRESHOLD) return
    const now = event.timeStamp
    if (now - lastWheelRef.current < WHEEL_COOLDOWN_MS) return
    lastWheelRef.current = now
    step(delta > 0 ? 1 : -1)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // 화살표 버튼을 누른 것은 드래그가 아니다 — 여기서 잡으면 클릭이 눌리다 말 수 있다.
    if (event.target instanceof Element && event.target.closest('button')) return
    dragStartRef.current = event.clientX
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current === null) return
    const raw = event.clientX - dragStartRef.current
    // 목록이 순환하므로 양 끝에서도 저항을 주지 않는다 — 어느 방향으로든 갈 곳이 있다.
    const offset = Math.max(-DRAG_LIMIT_PX, Math.min(DRAG_LIMIT_PX, raw))
    setDragOffset(offset)
    // 끌리는 동안은 손가락을 그대로 따라간다 — 애니메이션이 아니라 즉시 반영이다.
    track.set({ x: offset })
  }

  const handlePointerUp = () => {
    if (dragStartRef.current === null) return
    dragStartRef.current = null
    const travelled = dragOffset
    setDragOffset(0)
    if (Math.abs(travelled) < STEP_DISTANCE_PX[layout]) {
      // 문턱을 못 넘었으면 제자리로 되돌린다. 칸이 바뀌는 경우는 위 layout effect가 맡는다.
      void track.start({ x: 0, transition: ENTER })
      return
    }
    step(travelled > 0 ? -1 : 1)
  }

  if (!game) return null

  return (
    // 드래그·휠은 화살표·점 목록 위에 얹는 편의 조작이라 이 영역 자체는 조작 위젯이 아니다 —
    // 이름 있는 region으로 감싸기만 한다. 키보드·스크린리더의 진입점은 LandingProgress의 tablist다.
    <section
      aria-label="게임 캐러셀"
      className="relative h-full w-full touch-none select-none"
      onKeyDown={handleKeyDown}
      onPointerCancel={handlePointerUp}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
    >
      {/* 띠 전체를 한 덩어리로 움직인다 — 카드 세 장을 각각 애니메이션하면 이웃 카드가
          제 위치를 벗어나고, 퇴장 카드를 따로 그리면 3D 히어로가 두 벌 살아난다. */}
      <motion.div animate={track} className="absolute inset-0" initial={false}>
        {previous && <PeekCard game={previous} layout={layout} side="left" />}
        {next && <PeekCard game={next} layout={layout} side="right" />}
        <div
          aria-labelledby={landingTabId(game.key)}
          className={cn(
            'absolute inset-y-0',
            wide ? 'left-1/2 w-[69.4%] -translate-x-1/2' : 'inset-x-[6.7%]',
          )}
          id={LANDING_PANEL_ID}
          role="tabpanel"
        >
          <LandingHeroCard game={game} layout={layout} />
        </div>
      </motion.div>

      {/* 순환하므로 끝에서도 비활성이 없다. 모바일에도 둔다 — 스와이프는 발견 가능한
          조작이 아니고, 진행 표시줄 탭은 44px 세로만 확보돼 정밀 조준이 필요하다. */}
      <ArrowButton direction="previous" layout={layout} onClick={() => step(-1)} />
      <ArrowButton direction="next" layout={layout} onClick={() => step(1)} />
    </section>
  )
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
 * 양옆으로 반쯤 걸쳐 보이는 이웃 카드. 선택은 화살표·점 목록이 담당하므로 여기서는
 * 조작 대상을 늘리지 않고 "옆에 더 있다"만 말한다.
 */
function PeekCard({
  game,
  layout,
  side,
}: {
  game: LandingGame
  layout: 'narrow' | 'wide'
  side: 'left' | 'right'
}) {
  const wide = layout === 'wide'

  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute overflow-hidden border border-landing-hairline [background:var(--ds-landing-ghost)]',
        // 퍼센트는 레퍼런스 좌표(1440×472 / 390×436)를 그대로 옮긴 값이다.
        wide
          ? 'top-[7.2%] h-[85.6%] w-[36.1%] rounded-[26px] opacity-[0.34]'
          : 'top-[6%] h-[88%] w-[24.6%] rounded-[24px] opacity-40',
        wide
          ? side === 'left'
            ? 'left-[-12.2%]'
            : 'right-[-12.2%]'
          : side === 'left'
            ? 'left-[-14.9%]'
            : 'right-[-14.9%]',
      )}
    >
      {wide && (
        <span
          className={cn(
            'absolute bottom-6 max-w-[46%] text-[22px] font-bold text-landing-text-muted',
            side === 'left' ? 'left-6.5' : 'right-6.5 text-right',
          )}
        >
          {game.name}
        </span>
      )}
    </div>
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
        'absolute top-1/2 z-1 grid size-tap -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-landing-hairline-strong bg-landing-panel text-landing-text transition-colors duration-150 ease-out hover:border-landing-accent focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2',
        // 모바일 카드는 화면 폭의 86.6%를 쓴다 — 화살표를 카드 안으로 넣으면 3D를 가리므로
        // 카드와 화면 가장자리 사이 좁은 띠에 겹쳐 세운다.
        wide ? 'size-14 text-[20px]/none' : 'text-[17px]/none',
        isNext ? (wide ? 'right-11' : 'right-1') : wide ? 'left-11' : 'left-1',
      )}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true">{isNext ? '›' : '‹'}</span>
    </button>
  )
}
