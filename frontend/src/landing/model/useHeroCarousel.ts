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

const STEP_DISTANCE_PX = { narrow: 42, wide: 64 }
const DRAG_ACTIVATION_PX = 8
const DRAG_LIMIT_PX = 140
const WHEEL_COOLDOWN_MS = 340
const WHEEL_THRESHOLD = 18
const SLIDE_DISTANCE_PCT = { narrow: 53.3, wide: 43.25 }

interface UseHeroCarouselOptions {
  activeIndex: number
  games: Game[]
  layout: 'narrow' | 'wide'
  onSelect: (index: number) => void
}

export function useHeroCarousel({ activeIndex, games, layout, onSelect }: UseHeroCarouselOptions) {
  const wide = layout === 'wide'
  const [dragOffset, setDragOffset] = useState(0)
  const dragStartRef = useRef<number | null>(null)
  const draggedRef = useRef(false)
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
  const stepRef = useRef(step)
  useLayoutEffect(() => {
    stepRef.current = step
  })

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
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (Math.abs(delta) < WHEEL_THRESHOLD) return
    const now = event.timeStamp
    if (now - lastWheelRef.current < WHEEL_COOLDOWN_MS) return
    lastWheelRef.current = now
    step(delta > 0 ? 1 : -1)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    dragStartRef.current = event.clientX
    draggedRef.current = false
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current === null) return
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

    const offset = Math.max(-DRAG_LIMIT_PX, Math.min(DRAG_LIMIT_PX, raw))
    setDragOffset(offset)
    slideAnim.current?.stop()
    trackX.set(offset)
  }

  const handlePointerUp = () => {
    if (dragStartRef.current === null) return
    dragStartRef.current = null
    if (!draggedRef.current) return

    const travelled = dragOffset
    setDragOffset(0)
    if (Math.abs(travelled) < STEP_DISTANCE_PX[layout]) {
      slideAnim.current?.stop()
      slideAnim.current = animate(trackX, 0, ENTER)
      return
    }
    step(travelled > 0 ? -1 : 1)
  }

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

function keyboardStep(event: globalThis.KeyboardEvent) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return 0
  const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
  if (delta === 0) return 0
  const target = event.target as HTMLElement | null
  const guarded = target?.closest('input, textarea, select, [contenteditable], [aria-modal="true"]')
  return guarded ? 0 : delta
}

function circularDelta(from: number, to: number, length: number) {
  const raw = to - from
  if (raw > length / 2) return raw - length
  if (raw < -length / 2) return raw + length
  return raw
}
