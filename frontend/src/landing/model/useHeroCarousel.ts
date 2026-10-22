import { animate, useMotionValue, useReducedMotion } from 'motion/react'
import { useLayoutEffect, useRef, type WheelEvent } from 'react'
import type { Game } from '@/games'
import { ENTER } from '@/shared/motion'
import { useCarouselDrag } from './useCarouselDrag'
import { useCarouselKeys } from './useCarouselKeys'

const STEP_DISTANCE_PX = { narrow: 42, wide: 64 }
const WHEEL_COOLDOWN_MS = 340
const WHEEL_THRESHOLD = 18
const SLIDE_DISTANCE_PCT = { narrow: 53.3, wide: 43.25 }

interface UseHeroCarouselOptions {
  activeIndex: number
  games: Game[]
  layout: 'narrow' | 'wide'
  onSelect: (index: number) => void
}

/**
 * 히어로 캐러셀의 인덱스 이동(휠·키보드·드래그)과 슬라이드 애니메이션.
 * 드래그 자체는 [`useCarouselDrag`](./useCarouselDrag.ts)에 있다.
 */
export function useHeroCarousel({ activeIndex, games, layout, onSelect }: UseHeroCarouselOptions) {
  const wide = layout === 'wide'
  const lastWheelRef = useRef(0)
  const trackX = useMotionValue<number | string>(0)
  const slideAnim = useRef<ReturnType<typeof animate> | null>(null)
  const reduceMotion = useReducedMotion()
  const previousIndexRef = useRef(activeIndex)

  const game = games[activeIndex]
  const previousIndex = (activeIndex - 1 + games.length) % games.length
  const nextIndex = (activeIndex + 1) % games.length
  const previous = games[previousIndex]
  const next = games[nextIndex]

  const stopSlide = () => slideAnim.current?.stop()
  const animateTo = (value: number) => {
    slideAnim.current = animate(trackX, value, ENTER)
  }

  useLayoutEffect(() => {
    const from = previousIndexRef.current
    previousIndexRef.current = activeIndex
    if (from === activeIndex) return
    slideAnim.current?.stop()
    if (reduceMotion) {
      trackX.set(0)
      return
    }
    const direction = Math.sign(circularDelta(from, activeIndex, games.length))
    trackX.set(`${direction * SLIDE_DISTANCE_PCT[layout]}%`)
    slideAnim.current = animate(trackX, '0%', ENTER)
  }, [activeIndex, games.length, layout, reduceMotion, trackX])

  const step = (delta: number) => {
    const target = (activeIndex + delta + games.length) % games.length
    if (target !== activeIndex) onSelect(target)
  }
  useCarouselKeys(step)

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (Math.abs(delta) < WHEEL_THRESHOLD) return
    const now = event.timeStamp
    if (now - lastWheelRef.current < WHEEL_COOLDOWN_MS) return
    lastWheelRef.current = now
    step(delta > 0 ? 1 : -1)
  }

  const drag = useCarouselDrag({
    step,
    stepDistance: STEP_DISTANCE_PX[layout],
    stopSlide,
    trackX,
    animateTo,
  })

  return {
    ...drag,
    game,
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

/** 원형 목록에서 가까운 방향 — 마지막에서 첫 장으로 넘어갈 때도 한 칸만 움직인다. */
function circularDelta(from: number, to: number, length: number) {
  const raw = to - from
  if (raw > length / 2) return raw - length
  if (raw < -length / 2) return raw + length
  return raw
}
