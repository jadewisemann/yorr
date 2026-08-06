import type { ReactNode } from 'react'
import { cn } from '@/shared/cn'
import type { SpotlightRect } from '@/yacht/components/TutorialGuide/types'

/**
 * 각 단계에서 강조할 화면 조각. GamePlay가 붙여 둔 data-tutorial 표지를 찾는다 —
 * 좌표를 여기 적어 두면 레이아웃이 바뀔 때마다 조용히 어긋난다.
 *
 * 족보를 설명하는 동안에는 설명 중인 **그 칸**을 짚는다. 규칙만 읽어 주면 점수표에서 어느
 * 칸인지는 여전히 모르므로, 이름과 자리를 같은 순간에 붙여 준다.
 */
/**
 * 설명 카드. 강조한 곳을 가리면 안 되므로 구멍의 반대쪽 절반에 붙는다 —
 * 아래를 밝혔으면 위로, 위를 밝혔으면 아래로.
 *
 * 폭은 26rem에서 멈추고 가운데 선다. 딤과 차단막은 뷰포트를 덮어야 하므로 이 오버레이의
 * 컨테이닝 블록은 뷰포트지만(구멍 좌표가 getBoundingClientRect 값이다), 카드는 **읽기 좋은
 * 한 덩어리**여야 한다 — 게임 열(max-w-play, 넓은 화면에서 1536px)에 맞추면 한 줄에 글자가
 * 100자 넘게 들어가 읽기 어렵고, 안의 버튼도 그만큼 멀어져 누르기 나쁘다.
 * mx-auto가 left/right 둘 다 잡힌 절대 요소를 상한 안에서 가운데로 되돌린다.
 * 모바일(375px)에서는 inset-x-4가 먼저 걸려 종전과 같은 343px이다.
 */
export function Card({
  anchor,
  children,
  spotlight,
}: {
  /** 설명 중인 족보 칸. 있으면 카드가 그 칸 옆에 말풍선으로 붙는다. */
  anchor: SpotlightRect | null
  children: ReactNode
  spotlight: SpotlightRect | null
}) {
  const placement = anchor && anchoredPlacement(anchor)
  const below = spotlight !== null && spotlight.top < window.innerHeight / 2

  return (
    <div
      className={cn(
        'pointer-events-auto absolute grid gap-2.5 rounded-card border border-white/20 bg-surface-raised p-4 shadow-raised',
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
      {/* 말풍선 꼬리 — 설명하는 칸을 가리킨다. 카드와 같은 배경을 45° 돌려 변에 반쯤 걸친다. */}
      {placement && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute size-3 rotate-45 border-white/20 bg-surface-raised',
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

/**
 * 족보 칸 옆에 붙는 자리. 왼쪽에 카드가 설 자리가 있으면(넓은 화면 — 점수표가 오른쪽
 * 패널이라 왼쪽이 게임 영역이다) 칸의 왼쪽에 세우고, 없으면(좁은 화면 — 칩 줄) 칩 위에
 * 세운다. 칸이 넘어가면 구멍과 함께 카드도 따라 움직인다.
 */
export function anchoredPlacement(anchor: SpotlightRect) {
  const gap = 14
  if (anchor.left >= 400) {
    // ponytail: 카드 실제 높이를 모른 채 중심을 화면 안쪽으로 죈다(카드 ≤ 260px 가정).
    // 넘치는 화면이 나오면 카드 높이를 재서 죄는 것으로 올린다.
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
  // 칩 줄 위. 꼬리는 카드 폭 안에서 칩의 가운데를 따라간다.
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

/** 요르 마스코트 — 눈이 주사위 눈(2)인 흰 주사위. */
export function DiceBuddy({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn('size-11 flex-none drop-shadow-[0_4px_8px_rgb(0_0_0_/_40%)]', className)}
      viewBox="0 0 64 64"
    >
      <rect fill="#FAFAF7" height="52" rx="15" stroke="rgb(0 0 0 / 12%)" width="52" x="6" y="6" />
      {/* 눈 두 개 = 주사위 2. 깜빡임 대신 고정 — 모션 최소화. */}
      <circle cx="23" cy="27" fill="#191919" r="4.4" />
      <circle cx="41" cy="27" fill="#191919" r="4.4" />
      <circle cx="24.6" cy="25.4" fill="#fff" r="1.4" />
      <circle cx="42.6" cy="25.4" fill="#fff" r="1.4" />
      {/* 발그레한 볼과 웃는 입 — 브랜드 레드를 살짝만 쓴다. */}
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
