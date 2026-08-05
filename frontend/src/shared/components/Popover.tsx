import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/shared/cn'
import { popVariants, scrimVariants } from '@/shared/motion'
import { useDialogBackground } from '@/shared/useDialogBackground'

interface PopoverProps {
  /**
   * 꼬리를 물릴 기준 요소 — 보통 이 팝오버를 연 버튼이다. 넘기면 그 아래(아래가 좁으면 위)에
   * 붙고 뷰포트 안으로 눌러 넣는다. 넘기지 않으면 랜딩 헤더 우상단 고정 자리에 그린다.
   */
  anchorRef?: RefObject<HTMLElement | null> | undefined
  children: ReactNode
  className?: string | undefined
  /** 열자마자 초점을 둘 요소의 선택자. 무엇을 하러 열었는지에 따라 다르다. */
  focusSelector?: string
  label: string
  onClose: () => void
  open: boolean
  width?: number | undefined
}

/** 뷰포트 가장자리에 남겨 둘 여백. */
const VIEWPORT_MARGIN = 12
/** 앵커와 패널 사이 틈. 꼬리(7px)가 이 안에 들어간다. */
const ANCHOR_GAP = 10
/** 랜딩 팝오버와 같은 폭(w-98). 좁은 화면에서는 뷰포트에 맞춰 줄인다. */
const PANEL_WIDTH = 392
/** 아래 공간이 이보다 좁으면 위로 뒤집는 것을 검토한다. */
const MIN_PANEL_HEIGHT = 200
/** 패널 p-6(24px × 2). 내용 스크롤 높이를 계산할 때 뺀다. */
const PANEL_PADDING = 48
/** 꼬리가 둥근 모서리(20px)를 타지 않게 두는 여유. */
const TAIL_INSET = 20
/** 45° 회전한 꼬리의 절반. */
const TAIL_HALF = 7

interface Placement {
  bottom: number | undefined
  /** 앵커 위로 뒤집혔는지. 꼬리 방향과 자라는 방향이 함께 뒤집힌다. */
  flipped: boolean
  left: number
  maxContentHeight: number
  /** 패널 왼쪽 기준 꼬리 x. 패널이 뷰포트 안으로 눌려도 꼬리는 앵커를 가리켜야 한다. */
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
  // 앵커 중앙에 맞추되 뷰포트 안으로 눌러 넣는다 — 320px에서 헤더 우측 버튼에 그대로 맞추면
  // 패널 오른쪽이 화면 밖으로 나간다.
  const left = clamp(
    rect.left + rect.width / 2 - width / 2,
    VIEWPORT_MARGIN,
    innerWidth - VIEWPORT_MARGIN - width,
  )
  const below = innerHeight - rect.bottom - ANCHOR_GAP - VIEWPORT_MARGIN
  const above = rect.top - ANCHOR_GAP - VIEWPORT_MARGIN
  // 아래가 좁을 때만, 그리고 위가 더 넓을 때만 뒤집는다 — 헤더 버튼(위가 좁다)에서는
  // 아래가 좁아도 뒤집지 않는 게 낫다.
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

/**
 * 앵커 버튼에 꼬리를 물린 팝오버 껍데기. 바깥 탭(스크림)·Escape로 닫힌다.
 * <p>
 * 이 껍데기는 `<main>` 밖에 그려야 한다 — `useDialogBackground`가 배경 `<main>`에 `inert`를
 * 걸어 뒤 화면을 무력화하므로, 안에 있으면 자기 자신이 잠긴다.
 */
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
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [placement, setPlacement] = useState<Placement | null>(null)

  useDialogBackground(open)

  // 페인트 전에 자리를 잡는다 — useEffect로 미루면 첫 프레임이 엉뚱한 곳에 그려진다.
  useLayoutEffect(() => {
    const anchor = anchorRef?.current
    if (!open || !anchor) return
    const measure = () => setPlacement(placeByAnchor(anchor, width))
    measure()
    // 화면 회전·주소창 접힘으로 뷰포트가 바뀌면 앵커도 함께 움직인다.
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [anchorRef, open, width])

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    panelRef.current?.querySelector<HTMLElement>(focusSelector)?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [focusSelector, open])

  // 앵커를 받았고 자리 계산까지 끝났을 때만 앵커 배치를 쓴다.
  const placed = anchorRef ? placement : null

  return (
    // 퇴장 애니메이션을 그리려면 닫힌 뒤에도 한 프레임 더 살아 있어야 한다.
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
            // 포커스 표시가 없는 전체 화면 버튼이라 탭 순서에서 뺀다.
            // 키보드로 닫는 길은 Escape로 이미 있다.
            tabIndex={-1}
            type="button"
            variants={scrimVariants}
          />
          <motion.div
            animate="visible"
            // 패널이 자체 제목을 그리므로 여기서 또 heading을 만들지 않는다.
            aria-label={label}
            aria-modal="true"
            className={cn(
              'absolute rounded-panel border border-landing-hairline-strong bg-surface-raised p-6 shadow-landing-popover',
              // 앵커가 없을 때(랜딩 헤더)의 고정 자리. 트리거는 폭이 제한된 헤더
              // (max-w-landing) 안에 있는데 이 껍데기는 fixed inset-0이라 뷰포트 기준이다.
              // 헤더가 가운데로 모이는 폭부터는 헤더 우측단을 따라가야 한다 — 안 그러면
              // 2560에서 트리거와 팝오버가 480px 어긋난다.
              !placed &&
                'top-26 right-3 w-[min(24.5rem,calc(100%-1.5rem))] [@media(min-width:760px)]:right-[max(calc((100%-min(100%,var(--ds-size-landing)))/2+0.153*min(100%,var(--ds-size-landing))),env(safe-area-inset-right))]',
              className,
            )}
            exit="exit"
            initial="hidden"
            ref={panelRef}
            role="dialog"
            // 팝오버는 트리거 쪽에서 자라야 위치 관계가 읽힌다.
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
            {/*
              내용만 스크롤시킨다 — 스크롤을 패널에 걸면 밖으로 튀어나온 꼬리가 잘린다.
              앵커가 없을 때는 감싸지 않는다(랜딩 레이아웃을 건드리지 않기 위해).
            */}
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
