import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useRef } from 'react'
import { popVariants, scrimVariants } from '@/shared/motion'
import { useDialogBackground } from '@/shared/useDialogBackground'

interface PopoverProps {
  children: ReactNode
  /** 열자마자 초점을 둘 요소의 선택자. 무엇을 하러 열었는지에 따라 다르다. */
  focusSelector?: string
  label: string
  onClose: () => void
  open: boolean
}

/**
 * 랜딩 헤더 버튼에 꼬리를 물린 팝오버 껍데기.
 * <p>
 * 이 껍데기는 `<main>` 밖에 그려야 한다 — `useDialogBackground`가 배경 `<main>`에 `inert`를
 * 걸어 뒤 화면을 무력화하므로, 안에 있으면 자기 자신이 잠긴다.
 */
export function Popover({
  children,
  focusSelector = 'input, button',
  label,
  onClose,
  open,
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useDialogBackground(open)

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
            // 트리거는 폭이 제한된 헤더(max-w-landing) 안에 있는데 이 껍데기는 fixed inset-0이라
            // 뷰포트 기준이다. 헤더가 가운데로 모이는 폭부터는 헤더 우측단을 따라가야 한다 —
            // 안 그러면 2560에서 트리거와 팝오버가 480px 어긋난다.
            className="absolute top-26 right-[max(calc((100%-min(100%,var(--ds-size-landing)))/2+0.153*min(100%,var(--ds-size-landing))),env(safe-area-inset-right))] w-98 rounded-[20px] border border-landing-hairline-strong bg-surface-raised p-6 shadow-landing-popover"
            exit="exit"
            initial="hidden"
            ref={panelRef}
            role="dialog"
            // 팝오버는 트리거(우상단) 쪽에서 자라야 위치 관계가 읽힌다.
            style={{ transformOrigin: 'top right' }}
            variants={popVariants}
          >
            <span
              aria-hidden="true"
              className="absolute -top-[7px] right-13 size-3.5 rotate-45 border-t border-l border-landing-hairline-strong bg-surface-raised"
            />
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
