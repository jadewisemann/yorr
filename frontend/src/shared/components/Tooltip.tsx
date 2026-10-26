import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/shared/cn'

interface TooltipProps {
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom'
  className?: string
  content: ReactNode
  label: string
  children?: ReactNode
  spotlight?: boolean
}

/**
 * 열림 상태와 그 열림이 "지나가며 열린 것"(hover·focus)인지를 함께 든다. 지나가며 열린
 * 말풍선은 이어지는 클릭에 닫히지 않는다 — 탭 한 번이 focus와 click을 함께 일으키기 때문이다.
 */
function usePassiveToggle() {
  const [open, setOpen] = useState(false)
  const passiveOpenRef = useRef(false)

  const openPassively = () => {
    if (open) return
    passiveOpenRef.current = true
    setOpen(true)
  }

  const toggleByClick = () => {
    if (!open) {
      setOpen(true)
    } else if (!passiveOpenRef.current) {
      setOpen(false)
    }
    passiveOpenRef.current = false
  }

  const leavePassively = () => {
    if (!passiveOpenRef.current) return
    passiveOpenRef.current = false
    setOpen(false)
  }

  const close = () => {
    passiveOpenRef.current = false
    setOpen(false)
  }

  return { close, leavePassively, open, openPassively, setOpen, toggleByClick }
}

/** 열려 있는 동안 Escape나 말풍선 바깥 포인터로 닫는다. */
function useDismissOutside(
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
  setOpen: (open: boolean) => void,
) {
  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    document.addEventListener('pointerdown', closeOnOutside)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('pointerdown', closeOnOutside)
    }
  }, [open, rootRef, setOpen])
}

interface TooltipBubbleProps {
  align: NonNullable<TooltipProps['align']>
  content: ReactNode
  id: string
  side: NonNullable<TooltipProps['side']>
}

function TooltipBubble({ align, content, id, side }: TooltipBubbleProps) {
  return (
    <span
      className={cn(
        'absolute z-modal w-max max-w-56 rounded-card border border-border-raised bg-surface-raised px-3 py-2 text-left text-xs leading-relaxed font-medium text-content shadow-raised',
        side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
        align === 'center' && 'left-1/2 -translate-x-1/2',
        align === 'start' && 'left-0',
        align === 'end' && 'right-0',
      )}
      id={id}
      role="tooltip"
    >
      {content}
    </span>
  )
}

export function Tooltip({
  align = 'center',
  children,
  className,
  content,
  label,
  side = 'bottom',
  spotlight = false,
}: TooltipProps) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const bubbleId = useId()
  const toggle = usePassiveToggle()
  const { open } = toggle

  useDismissOutside(open, rootRef, toggle.setOpen)

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover는 데스크톱 보조 트리거일 뿐이다 — 필수 상호작용(탭·포커스·키보드)은 안의 버튼이 전부 가진다
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={toggle.openPassively}
      onMouseLeave={toggle.leavePassively}
      ref={rootRef}
    >
      <button
        aria-describedby={open ? bubbleId : undefined}
        aria-expanded={open}
        aria-label={label}
        className={cn(
          'relative inline-flex cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-inherit before:absolute before:top-1/2 before:left-1/2 before:size-tap before:-translate-x-1/2 before:-translate-y-1/2 focus-ring focus-visible:outline-offset-2 active:scale-90',
          spotlight &&
            'text-content ring-3 ring-brand-strong ring-offset-2 ring-offset-surface-raised motion-safe:animate-ring-pulse',
        )}
        onBlur={toggle.close}
        onClick={toggle.toggleByClick}
        onFocus={toggle.openPassively}
        type="button"
      >
        {children ?? (
          <span
            aria-hidden="true"
            className="grid size-4.5 place-items-center rounded-full border border-current text-2xs leading-none font-bold"
          >
            ?
          </span>
        )}
      </button>
      {open && <TooltipBubble align={align} content={content} id={bubbleId} side={side} />}
    </span>
  )
}
