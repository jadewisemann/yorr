import { AnimatePresence, type MotionStyle, motion } from 'motion/react'
import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/shared/cn'
import { DialogScrim } from '@/shared/components/DialogScrim'
import { popVariants } from '@/shared/motion'
import { useDialogBackground } from '@/shared/useDialogBackground'
import { useDialogFocus } from '@/shared/useDialogFocus'
import { type Placement, placeByAnchor, TAIL_HALF } from './popoverPlacement'

export function PopoverHeader({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="flex items-baseline justify-between pb-1">
      <h2 className="m-0 text-base font-bold">{children}</h2>
      <button
        className="-my-3 -mr-2 inline-flex min-h-tap cursor-pointer items-center border-0 bg-transparent px-2 text-xs font-semibold text-content-muted transition-[color,scale] duration-150 hover:text-content active:scale-[0.94] focus-ring focus-visible:outline-offset-2"
        onClick={onClose}
        type="button"
      >
        닫기
      </button>
    </div>
  )
}

interface PopoverProps {
  anchorRef?: RefObject<HTMLElement | null> | undefined
  children: ReactNode
  className?: string | undefined
  focusSelector?: string
  label: string
  onClose: () => void
  open: boolean
  width?: number | undefined
}

/** 앵커가 있으면 그 기준 배치를 재고, 창 크기·스크롤이 바뀔 때마다 다시 잰다. */
function useAnchorPlacement(
  anchorRef: RefObject<HTMLElement | null> | undefined,
  open: boolean,
  width: number | undefined,
) {
  const [placement, setPlacement] = useState<Placement | null>(null)

  useLayoutEffect(() => {
    const anchor = anchorRef?.current
    if (!open || !anchor) return
    const measure = () => setPlacement(placeByAnchor(anchor, width))
    measure()
    window.addEventListener('resize', measure)
    document.addEventListener('scroll', measure, { capture: true, passive: true })
    return () => {
      window.removeEventListener('resize', measure)
      document.removeEventListener('scroll', measure, { capture: true })
    }
  }, [anchorRef, open, width])

  return anchorRef ? placement : null
}

function panelStyle(placed: Placement | null): MotionStyle {
  if (!placed) return { transformOrigin: 'top right' }
  return {
    bottom: placed.bottom,
    left: placed.left,
    top: placed.top,
    transformOrigin: `${placed.tailLeft}px ${placed.flipped ? 'bottom' : 'top'}`,
    width: placed.width,
  }
}

function PopoverTail({ placed }: { placed: Placement | null }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute size-3.5 rotate-45 border-landing-hairline-strong bg-surface-raised',
        placed?.flipped ? '-bottom-[7px] border-r border-b' : '-top-[7px] border-t border-l',
        !placed && 'right-13',
      )}
      style={placed ? { left: placed.tailLeft - TAIL_HALF } : undefined}
    />
  )
}

export function Popover({
  anchorRef,
  children,
  className,
  focusSelector = 'input, button',
  label,
  onClose,
  open,
  width,
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useDialogBackground(open)
  const placed = useAnchorPlacement(anchorRef, open, width)
  useDialogFocus(open, {
    initialFocus: (selector = focusSelector) =>
      panelRef.current?.querySelector<HTMLElement>(selector),
    onKeyDown: (event) => {
      if (event.key === 'Escape') onClose()
    },
    selector: focusSelector,
  })

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-modal">
          <DialogScrim label="배경을 눌러 닫기" onClose={onClose} />
          <motion.div
            animate="visible"
            aria-label={label}
            aria-modal="true"
            className={cn(
              'absolute rounded-panel border border-landing-hairline-strong bg-surface-raised p-6 shadow-landing-popover',
              !placed &&
                'top-26 right-3 w-[min(24.5rem,calc(100%-1.5rem))] [@media(min-width:760px)]:right-[max(calc((100%-min(100%,var(--ds-size-landing)))/2+0.153*min(100%,var(--ds-size-landing))),env(safe-area-inset-right))]',
              className,
            )}
            exit="exit"
            initial="hidden"
            ref={panelRef}
            role="dialog"
            style={panelStyle(placed)}
            variants={popVariants}
          >
            <PopoverTail placed={placed} />
            {placed ? (
              <div
                className="overflow-y-auto overscroll-contain"
                style={{ maxHeight: placed.maxContentHeight }}
              >
                {children}
              </div>
            ) : (
              children
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
