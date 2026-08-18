import type { ReactNode } from 'react'
import { cn } from '@/shared/cn'
import type { SpotlightRect } from '@/yacht/components/TutorialGuide/types'

export function Card({
  anchor,
  children,
  spotlight,
}: {
  anchor: SpotlightRect | null
  children: ReactNode
  spotlight: SpotlightRect | null
}) {
  const placement = anchor && anchoredPlacement(anchor)
  const below = spotlight !== null && spotlight.top < window.innerHeight / 2

  return (
    <div
      className={cn(
        'pointer-events-auto absolute grid gap-2 rounded-card border border-border-strong bg-surface-raised p-4 shadow-raised',
        placement
          ? 'w-88 max-w-[calc(100vw-2rem)]'
          : cn(
              'inset-x-4 mx-auto max-w-104',
              spotlight === null
                ? 'top-1/2 -translate-y-1/2'
                : below
                  ? 'bottom-5'
                  : 'top-[max(1rem,env(safe-area-inset-top))]',
            ),
      )}
      style={placement?.style}
    >
      {placement && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute size-3 rotate-45 border-border-strong bg-surface-raised',
            placement.tail === 'right'
              ? 'top-1/2 -right-1.5 -translate-y-1/2 border-t border-r'
              : '-bottom-1.5 border-r border-b',
          )}
          style={placement.tailStyle}
        />
      )}
      <div className="flex items-start gap-3">
        <DiceBuddy className="motion-safe:animate-guide-bob" />
        <div className="grid min-w-0 flex-1 gap-2">{children}</div>
      </div>
    </div>
  )
}

export function anchoredPlacement(anchor: SpotlightRect) {
  const gap = 14
  if (anchor.left >= 400) {
    const centerY = Math.min(
      Math.max(anchor.top + anchor.height / 2, 140),
      window.innerHeight - 140,
    )
    return {
      style: {
        top: centerY,
        right: window.innerWidth - anchor.left + gap,
        transform: 'translateY(-50%)',
      },
      tail: 'right' as const,
      tailStyle: undefined,
    }
  }
  const holeCenterX = anchor.left + anchor.width / 2
  return {
    style: { bottom: window.innerHeight - anchor.top + gap, left: 16, right: 16 },
    tail: 'bottom' as const,
    tailStyle: { left: Math.min(Math.max(holeCenterX - 16 - 6, 18), window.innerWidth - 68) },
  }
}

export function GuideTextButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="cursor-pointer border-0 bg-transparent p-1 text-xs font-semibold text-content-faint underline underline-offset-2 transition-colors hover:text-content focus-ring focus-visible:outline-offset-2 pressable"
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  )
}

export function DiceBuddy({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn('size-11 flex-none drop-shadow-[0_4px_8px_rgb(0_0_0_/_40%)]', className)}
      viewBox="0 0 64 64"
    >
      <rect fill="#FAFAF7" height="52" rx="15" stroke="rgb(0 0 0 / 12%)" width="52" x="6" y="6" />
      <circle cx="23" cy="27" fill="#191919" r="4.4" />
      <circle cx="41" cy="27" fill="#191919" r="4.4" />
      <circle cx="24.6" cy="25.4" fill="#fff" r="1.4" />
      <circle cx="42.6" cy="25.4" fill="#fff" r="1.4" />
      <circle cx="17.5" cy="35" fill="rgb(229 57 53 / 28%)" r="3" />
      <circle cx="46.5" cy="35" fill="rgb(229 57 53 / 28%)" r="3" />
      <path
        d="M25 38.5c2.4 3.4 11.6 3.4 14 0"
        fill="none"
        stroke="#191919"
        strokeLinecap="round"
        strokeWidth="2.6"
      />
    </svg>
  )
}
