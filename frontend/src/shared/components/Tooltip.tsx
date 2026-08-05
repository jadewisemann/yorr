import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/shared/cn'

interface TooltipProps {
  /** 말풍선이 트리거 기준 어디에 뜨는지. 화면 가장자리에 붙은 트리거는 반대쪽을 지정한다. */
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom'
  className?: string
  /** 말풍선 본문. 짧은 설명 한두 문장 — 길어지면 도움말 모달로 옮긴다. */
  content: ReactNode
  /** 트리거 버튼의 접근성 이름 ("남은 굴리기 설명" 등). */
  label: string
  /** 트리거로 보일 내용. 생략하면 ⓘ 아이콘 버튼이 된다. */
  children?: ReactNode
  /**
   * 첫 진입 안내가 이 툴팁을 가리키는 중인지. 어두워진 화면 위로 트리거만 도드라진다 —
   * 좌표를 따로 재서 링을 그리면 툴팁이 움직일 때마다 어긋나므로 트리거 자신이 빛난다.
   */
  spotlight?: boolean
}

/**
 * 탭해서 여닫는 툴팁(toggletip) — 모바일이 기본 타깃이라 hover에만 의존하지 않는다.
 * 데스크톱에서는 hover·포커스로도 열리고, Escape·바깥 탭으로 닫힌다.
 */
export function Tooltip({
  align = 'center',
  children,
  className,
  content,
  label,
  side = 'bottom',
  spotlight = false,
}: TooltipProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const bubbleId = useId()
  // hover·포커스로 "지나가다 열린" 상태인지. 탭 한 번에 focus→click이 연달아 오는데,
  // 이를 구분하지 않으면 focus가 연 툴팁을 곧바로 click 토글이 닫아 아예 안 열려 보인다.
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
    // hover·포커스로 열려 있었다면 클릭은 "고정"으로 승격만 한다 — 닫으면 깜빡인다.
    passiveOpenRef.current = false
  }

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
  }, [open])

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover는 데스크톱 보조 트리거일 뿐이다 — 필수 상호작용(탭·포커스·키보드)은 안의 버튼이 전부 가진다
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={openPassively}
      onMouseLeave={() => {
        // 클릭으로 고정한 툴팁은 hover가 끝나도 남는다 — Escape·바깥 탭·blur로 닫는다.
        if (!passiveOpenRef.current) return
        passiveOpenRef.current = false
        setOpen(false)
      }}
      ref={rootRef}
    >
      <button
        aria-describedby={open ? bubbleId : undefined}
        aria-expanded={open}
        aria-label={label}
        // 보이는 ⓘ는 18px로 두고 히트 영역만 의사요소로 min-h-tap까지 넓힌다.
        // 버튼 자신의 상자는 그대로라 인접 텍스트를 밀지 않고 포커스 링도 글리프에 붙는다.
        className={cn(
          'relative inline-flex cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-inherit before:absolute before:top-1/2 before:left-1/2 before:size-tap before:-translate-x-1/2 before:-translate-y-1/2 focus-ring focus-visible:outline-offset-2',
          // 딤 레이어는 이 트리거가 얹힌 밴드보다 아래에 깔리므로 z는 건드리지 않는다 —
          // 여기서는 "여기다"라고 말하는 링만 그린다.
          spotlight &&
            'text-content ring-3 ring-brand-strong ring-offset-2 ring-offset-surface-raised motion-safe:animate-ring-pulse',
        )}
        onBlur={() => {
          passiveOpenRef.current = false
          setOpen(false)
        }}
        onClick={toggleByClick}
        onFocus={openPassively}
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
      {open && (
        <span
          className={cn(
            'absolute z-modal w-max max-w-56 rounded-card border border-border-raised bg-surface-raised px-3 py-2 text-left text-xs leading-relaxed font-medium text-content shadow-raised',
            side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
            align === 'center' && 'left-1/2 -translate-x-1/2',
            align === 'start' && 'left-0',
            align === 'end' && 'right-0',
          )}
          id={bubbleId}
          role="tooltip"
        >
          {content}
        </span>
      )}
    </span>
  )
}
