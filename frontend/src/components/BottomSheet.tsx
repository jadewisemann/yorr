import { AnimatePresence, m } from 'motion/react'
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import { cn } from '@/cn'
import { scrimVariants, sheetVariants } from '@/motion'
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

function keepFocusInSheet(event: KeyboardEvent, root: HTMLElement | null, close: () => void) {
  if (event.key === 'Escape') {
    close()
    return
  }
  if (event.key !== 'Tab') return

  const focusables = focusablesIn(root)
  const first = focusables[0]
  const last = focusables.at(-1)
  if (!first || !last) return

  const leavingStart = event.shiftKey && document.activeElement === first
  const leavingEnd = !event.shiftKey && document.activeElement === last
  if (!leavingStart && !leavingEnd) return

  event.preventDefault()
  ;(leavingStart ? last : first).focus()
}

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

    const onKeyDown = (event: KeyboardEvent) =>
      keepFocusInSheet(event, sheetRef.current, onCloseRef.current)

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) setDragOffset(0)
  }, [open])

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
    // 퇴장 애니메이션을 그리려면 닫힌 뒤에도 한 프레임 더 살아 있어야 한다 —
    // 조건부 렌더를 AnimatePresence 안으로 넣는 이유다.
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-sheet">
          <m.button
            animate="visible"
            aria-label="시트 닫기"
            className="absolute inset-0 cursor-default border-0 bg-scrim"
            exit="exit"
            initial="hidden"
            onClick={onClose}
            // 포커스 표시가 없는 전체 화면 버튼이라 탭 순서에서 뺀다.
            // 키보드로 닫는 길은 Escape로 이미 있다.
            tabIndex={-1}
            type="button"
            variants={scrimVariants}
          />
          <m.div
            animate="visible"
            // 시트 내용이 자체 제목을 그리므로 여기서 또 heading을 만들지 않는다.
            aria-label={title}
            aria-modal="true"
            className={cn(
              // pb-6(24px)만으로는 iOS 홈 인디케이터(34px) 아래로 마지막 줄이 들어간다.
              'absolute inset-x-0 bottom-0 flex h-[76%] flex-col rounded-t-sheet border-t border-white/14 bg-surface px-4 pt-2.5 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-overlay',
              className,
            )}
            exit="exit"
            initial="hidden"
            ref={sheetRef}
            role="dialog"
            // 진입·퇴장(variants)과 드래그가 같은 transform을 두고 다툰다 — variants가 인라인
            // y를 덮으므로, 여기서 둘을 이어 붙인다. 손가락은 즉시 따라가고 놓으면 0으로 돌아온다.
            transformTemplate={(_, generated) =>
              dragOffset > 0 ? `${generated} translateY(${dragOffset}px)` : generated
            }
            variants={sheetVariants}
          >
            <div
              className="-mx-4 -mt-2.5 cursor-grab px-4 pt-2.5 pb-2 touch-none"
              onPointerCancel={handlePointerUp}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              <span
                aria-hidden="true"
                className="mx-auto block h-1 w-11 rounded-full bg-white/24"
              />
            </div>
            {children}
          </m.div>
        </div>
      )}
    </AnimatePresence>
  )
}

function focusablesIn(root: HTMLElement | null) {
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
}
