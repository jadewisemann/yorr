import { type PointerEvent as ReactPointerEvent, useRef, useState } from 'react'

interface SheetDragOptions {
  /** 아래로 끄는 것만 센다 — 하단 시트는 위로 끌어도 따라 올라가지 않는다. */
  downwardOnly?: boolean
  /** 손을 뗀 순간의 이동량. 여기서 얼마나 끌어야 무엇을 하는지는 부르는 쪽이 정한다. */
  onRelease: (offset: number) => void
}

/**
 * 시트를 손가락으로 끄는 동작. 하단 시트와 기록 패널이 같은 배선을 쓰므로 한자리에 둔다
 * — 손을 뗀 뒤의 판단(닫을지, 펼칠지)만 갈린다.
 */
export function useSheetDrag({ downwardOnly = false, onRelease }: SheetDragOptions) {
  const dragStartRef = useRef<number | null>(null)
  const [dragOffset, setDragOffset] = useState(0)

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragStartRef.current = event.clientY
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current === null) return
    const moved = event.clientY - dragStartRef.current
    setDragOffset(downwardOnly ? Math.max(0, moved) : moved)
  }

  const onPointerUp = () => {
    if (dragStartRef.current === null) return
    const released = dragOffset
    dragStartRef.current = null
    setDragOffset(0)
    onRelease(released)
  }

  return { dragOffset, setDragOffset, onPointerDown, onPointerMove, onPointerUp }
}
