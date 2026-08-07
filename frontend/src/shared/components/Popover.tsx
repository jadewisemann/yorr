import { AnimatePresence, motion } from 'motion/react'
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { cn } from '@/shared/cn'
import { popVariants, scrimVariants } from '@/shared/motion'
import { useDialogBackground } from '@/shared/useDialogBackground'

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

const VIEWPORT_MARGIN = 12
const ANCHOR_GAP = 10
const PANEL_WIDTH = 392
const MIN_PANEL_HEIGHT = 200
const PANEL_PADDING = 48
const TAIL_INSET = 20
const TAIL_HALF = 7

interface Placement {
  bottom: number | undefined
  flipped: boolean
  left: number
  maxContentHeight: number
  tailLeft: number
  top: number | undefined
  width: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function placeByAnchor(anchor: HTMLElement, preferredWidth = PANEL_WIDTH): Placement {
  const rect = anchor.getBoundingClientRect()
  const { innerHeight, innerWidth } = window
  const width = Math.min(preferredWidth, innerWidth - VIEWPORT_MARGIN * 2)
  const left = clamp(
    rect.left + rect.width / 2 - width / 2,
    VIEWPORT_MARGIN,
    innerWidth - VIEWPORT_MARGIN - width,
  )
  const below = innerHeight - rect.bottom - ANCHOR_GAP - VIEWPORT_MARGIN
  const above = rect.top - ANCHOR_GAP - VIEWPORT_MARGIN
  const flipped = below < MIN_PANEL_HEIGHT && above > below

  return {
    bottom: flipped ? innerHeight - rect.top + ANCHOR_GAP : undefined,
    flipped,
    left,
    maxContentHeight: Math.max(flipped ? above : below, MIN_PANEL_HEIGHT) - PANEL_PADDING,
    tailLeft: clamp(rect.left + rect.width / 2 - left, TAIL_INSET, width - TAIL_INSET),
    top: flipped ? undefined : rect.bottom + ANCHOR_GAP,
    width,
  }
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
  const close = useEffectEvent(onClose)
  const [placement, setPlacement] = useState<Placement | null>(null)

  useDialogBackground(open)

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

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    panelRef.current?.querySelector<HTMLElement>(focusSelector)?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [focusSelector, open])

  const placed = anchorRef ? placement : null

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-modal">
          <motion.button
            animate="visible"
            aria-label="배경을 눌러 닫기"
            className="absolute inset-0 cursor-default border-0 bg-scrim"
            exit="exit"
            initial="hidden"
            onClick={onClose}
            tabIndex={-1}
            type="button"
            variants={scrimVariants}
          />
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
            style={
              placed
                ? {
                    bottom: placed.bottom,
                    left: placed.left,
                    top: placed.top,
                    transformOrigin: `${placed.tailLeft}px ${placed.flipped ? 'bottom' : 'top'}`,
                    width: placed.width,
                  }
                : { transformOrigin: 'top right' }
            }
            variants={popVariants}
          >
            <span
              aria-hidden="true"
              className={cn(
                'absolute size-3.5 rotate-45 border-landing-hairline-strong bg-surface-raised',
                placed?.flipped
                  ? '-bottom-[7px] border-r border-b'
                  : '-top-[7px] border-t border-l',
                !placed && 'right-13',
              )}
              style={placed ? { left: placed.tailLeft - TAIL_HALF } : undefined}
            />
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
