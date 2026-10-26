import { AnimatePresence, motion } from 'motion/react'
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import { cn } from '@/shared/cn'
import { DialogScrim } from '@/shared/components/DialogScrim'
import { sheetVariants } from '@/shared/motion'
import { useDialogBackground } from '@/shared/useDialogBackground'
import { useDialogFocus } from '@/shared/useDialogFocus'

interface BottomSheetProps {
  children: ReactNode
  className?: string
  onClose: () => void
  open: boolean
  title: string
}

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

/** 손잡이를 끌어 내리는 거리. 일정 거리를 넘겨 놓으면 닫는다. 닫히면 0으로 되돌린다. */
function useSheetDrag(open: boolean, onClose: () => void) {
  const [dragOffset, setDragOffset] = useState(0)
  const dragStartRef = useRef<number | null>(null)

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

  const handleProps = {
    onPointerCancel: handlePointerUp,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
  }
  return { dragOffset, handleProps }
}

export function BottomSheet({ children, className, onClose, open, title }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null)

  useDialogBackground(open)
  useDialogFocus(open, {
    initialFocus: () => focusablesIn(sheetRef.current)[0],
    onKeyDown: (event) => keepFocusInSheet(event, sheetRef.current, onClose),
  })
  const { dragOffset, handleProps } = useSheetDrag(open, onClose)

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-sheet">
          <DialogScrim label="시트 닫기" onClose={onClose} />
          <motion.div
            animate="visible"
            aria-label={title}
            aria-modal="true"
            className={cn(
              'absolute inset-x-0 bottom-0 flex h-[76%] flex-col rounded-t-sheet border-t border-border-raised bg-surface px-4 pt-2.5 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-overlay',
              className,
            )}
            exit="exit"
            initial="hidden"
            ref={sheetRef}
            role="dialog"
            transformTemplate={(_, generated) =>
              dragOffset > 0 ? `${generated} translateY(${dragOffset}px)` : generated
            }
            variants={sheetVariants}
          >
            <div className="-mx-4 -mt-2.5 cursor-grab px-4 pt-2.5 pb-2 touch-none" {...handleProps}>
              <span
                aria-hidden="true"
                className="mx-auto block h-1 w-11 rounded-full bg-surface-veil-strong"
              />
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

function focusablesIn(root: HTMLElement | null) {
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
}
