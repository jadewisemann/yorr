import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import { cn } from '@/cn'
import { useDialogBackground } from '@/useDialogBackground'

interface BottomSheetProps {
  children: ReactNode
  className?: string
  onClose: () => void
  open: boolean
  title: string
}

/** 이 거리 이상 아래로 끌면 닫는다. */
const DISMISS_DISTANCE_PX = 80

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** 화면 76% 높이 시트. 뒤 화면의 타이머·라운드는 스크림 위로 남는다(와이어프레임 ⑤). */
export function BottomSheet({ children, className, onClose, open, title }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const [dragOffset, setDragOffset] = useState(0)
  const dragStartRef = useRef<number | null>(null)

  // 부모가 매 렌더 새 onClose를 넘겨도 포커스 트랩이 다시 잡히지 않도록 ref로 읽는다.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // 포커스 effect보다 먼저 선언한다 — cleanup이 먼저 돌아야 inert가 풀린 뒤
  // 아래 effect가 뒤 화면의 원래 위치로 포커스를 되돌릴 수 있다.
  useDialogBackground(open)

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    focusablesIn(sheetRef.current)[0]?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusables = focusablesIn(sheetRef.current)
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!first || !last) return
      // 포커스가 시트 밖으로 새지 않게 양 끝에서 되돌린다.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) setDragOffset(0)
  }, [open])

  if (!open) return null

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragStartRef.current = event.clientY
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current === null) return
    setDragOffset(Math.max(0, event.clientY - dragStartRef.current))
  }

  const handlePointerUp = () => {
    if (dragStartRef.current === null) return
    const shouldClose = dragOffset > DISMISS_DISTANCE_PX
    dragStartRef.current = null
    setDragOffset(0)
    if (shouldClose) onClose()
  }

  return (
    <div className="fixed inset-0 z-sheet">
      <button
        aria-label="시트 닫기"
        className="absolute inset-0 cursor-default border-0 bg-scrim"
        onClick={onClose}
        type="button"
      />
      <div
        // 시트 내용이 자체 제목을 그리므로 여기서 또 heading을 만들지 않는다.
        aria-label={title}
        aria-modal="true"
        className={cn(
          'absolute inset-x-0 bottom-0 flex h-[76%] flex-col rounded-t-panel border-t border-border bg-surface px-4 pt-2.5 pb-6 shadow-overlay',
          className,
        )}
        ref={sheetRef}
        role="dialog"
        style={dragOffset > 0 ? { transform: `translateY(${dragOffset}px)` } : undefined}
      >
        <div
          className="-mx-4 -mt-2.5 cursor-grab px-4 pt-2.5 pb-2 touch-none"
          onPointerCancel={handlePointerUp}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <span aria-hidden="true" className="mx-auto block h-1 w-10 rounded-full bg-border" />
        </div>
        {children}
      </div>
    </div>
  )
}

function focusablesIn(root: HTMLElement | null) {
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
}
