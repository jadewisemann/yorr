import type { MotionValue } from 'motion/react'
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from 'react'

/** 손가락 흔들림 몇 px에 카드가 넘어가면 탭을 영영 못 한다(터치 슬롭과 같은 8px). */
const DRAG_ACTIVATION_PX = 8
const DRAG_LIMIT_PX = 140

interface UseCarouselDragOptions {
  stepDistance: number
  step: (delta: number) => void
  trackX: MotionValue<number | string>
  stopSlide: () => void
  animateTo: (value: number) => void
}

/**
 * 히어로 캐러셀의 포인터 드래그. 활성화 임계(8px) 전에는 탭으로 남기고, 임계를
 * 넘으면 포인터를 캡처해 트랙을 따라 움직인다. 놓을 때 한 칸 폭을 넘겼으면
 * 카드를 넘기고, 아니면 제자리로 돌린다.
 */
export function useCarouselDrag(options: UseCarouselDragOptions) {
  const { stepDistance, step, trackX, stopSlide, animateTo } = options
  const [dragOffset, setDragOffset] = useState(0)
  const dragStartRef = useRef<number | null>(null)
  const draggedRef = useRef(false)
  const dragOffsetRef = useRef(0)

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
    if (!draggedRef.current && Math.abs(raw) < DRAG_ACTIVATION_PX) return
    if (!draggedRef.current) {
      draggedRef.current = true
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    const offset = clampDrag(raw)
    dragOffsetRef.current = offset
    setDragOffset(offset)
    stopSlide()
    trackX.set(offset)
  }

  const handlePointerUp = () => {
    if (dragStartRef.current === null) return
    dragStartRef.current = null
    if (!draggedRef.current) return
    const travelled = dragOffsetRef.current
    dragOffsetRef.current = 0
    setDragOffset(0)
    // 한 칸을 넘길 만큼 끌지 않았으면 제자리로 돌아간다.
    if (Math.abs(travelled) < stepDistance) {
      stopSlide()
      animateTo(0)
      return
    }
    step(travelled > 0 ? -1 : 1)
  }

  /** 드래그 뒤 클릭은 카드 선택이 아니라 드래그의 잔재다 — 캡처 단계에서 삼킨다. */
  const handleClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!draggedRef.current || event.detail === 0) return
    draggedRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  return { dragOffset, handleClickCapture, handlePointerDown, handlePointerMove, handlePointerUp }
}

/** 드래그 오프셋을 한 칸 폭 안으로 자른다 — 더 끌어도 트랙이 따라오지 않는다. */
function clampDrag(raw: number): number {
  return Math.max(-DRAG_LIMIT_PX, Math.min(DRAG_LIMIT_PX, raw))
}
