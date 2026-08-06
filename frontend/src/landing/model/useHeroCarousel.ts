import { animate, useMotionValue, useReducedMotion } from 'motion/react'
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
import { ENTER } from '@/shared/motion'

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

interface UseHeroCarouselOptions {
  activeIndex: number
  games: Game[]
  layout: 'narrow' | 'wide'
  onSelect: (index: number) => void
}

/**
 * 히어로 캐러셀의 제스처와 슬라이드 애니메이션 — 드래그(포인터)·휠·키보드.
 *
 * 드래그를 임계값(8px)으로 가르는 이유는 카드 안 플레이 CTA 때문이다. pointerdown 에서
 * 바로 캡처하면 그 순간부터 호환 마우스 이벤트가 재타깃돼 카드 안 버튼의 click 이 아예
 * 발화하지 않는다.
 */
export function useHeroCarousel({ activeIndex, games, layout, onSelect }: UseHeroCarouselOptions) {
  const wide = layout === 'wide'
  const [dragOffset, setDragOffset] = useState(0)
  const dragStartRef = useRef<number | null>(null)
  /** 이번 제스처가 임계값을 넘겨 드래그로 승격했는지. 뒤따르는 click을 삼킬지의 근거다. */
  const draggedRef = useRef(false)
  const lastWheelRef = useRef(0)
  /**
   * 띠의 x는 MotionValue + 명령형 {@link animate}로 움직인다. useAnimationControls의
   * start()는 이 조합(레이아웃 이펙트 안 set→start)에서 애니메이션을 시작하지 못해 띠가
   * 출발점(±43%)에 그대로 주차됐다 — 카드가 화면 밖에 멈춘 채로 남는 실측 버그.
   */
  const trackX = useMotionValue<number | string>(0)
  const slideAnim = useRef<ReturnType<typeof animate> | null>(null)
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
    slideAnim.current?.stop()
    // 드래그로 넘어온 경우 x가 손가락 위치에 남아 있다 — 어느 쪽이든 0으로 정리한다.
    if (reduceMotion) {
      trackX.set(0)
      return
    }
    // 점을 눌러 두 칸 이상 건너뛰어도 화면에는 카드 세 장뿐이다. 한 칸 거리로 고정한다.
    const direction = Math.sign(circularDelta(from, activeIndex, games.length))
    trackX.set(`${direction * SLIDE_DISTANCE_PCT[layout]}%`)
    // 출발점과 같은 %-단위로 끝점을 준다 — 문자열끼리여야 보간이 성립한다.
    slideAnim.current = animate(trackX, '0%', ENTER)
  }, [activeIndex, games.length, layout, reduceMotion, trackX])

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
    slideAnim.current?.stop()
    trackX.set(offset)
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
      slideAnim.current?.stop()
      slideAnim.current = animate(trackX, 0, ENTER)
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

  return {
    dragOffset,
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
    reduceMotion,
    step,
    trackX,
    wide,
  }
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
