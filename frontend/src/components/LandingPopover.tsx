import { type ReactNode, useEffect, useRef } from 'react'
import { useDialogBackground } from '@/useDialogBackground'

interface LandingPopoverProps {
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
export function LandingPopover({
  children,
  focusSelector = 'input, button',
  label,
  onClose,
  open,
}: LandingPopoverProps) {
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

  if (!open) return null

  return (
    <div className="fixed inset-0 z-modal">
      <button
        aria-label="배경을 눌러 닫기"
        className="absolute inset-0 cursor-default border-0 bg-scrim"
        onClick={onClose}
        // 포커스 표시가 없는 전체 화면 버튼이라 탭 순서에서 뺀다.
        // 키보드로 닫는 길은 Escape로 이미 있다.
        tabIndex={-1}
        type="button"
      />
      <div
        // 패널이 자체 제목을 그리므로 여기서 또 heading을 만들지 않는다.
        aria-label={label}
        aria-modal="true"
        className="absolute top-26 right-11 w-98 rounded-[20px] border border-landing-hairline-strong bg-surface-raised p-6 shadow-landing-popover"
        ref={panelRef}
        role="dialog"
      >
        <span
          aria-hidden="true"
          className="absolute -top-[7px] right-13 size-3.5 rotate-45 border-t border-l border-landing-hairline-strong bg-surface-raised"
        />
        {children}
      </div>
    </div>
  )
}
