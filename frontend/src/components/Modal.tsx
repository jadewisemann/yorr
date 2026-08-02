import { type ReactNode, useEffect, useId, useRef } from 'react'
import { cn } from '@/cn'
import { useDialogBackground } from '@/useDialogBackground'

type ModalProps = {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
  className?: string
  /**
   * 되돌릴 수 없는 동작을 확인받을 때는 'alertdialog'를 쓴다. 스크린리더가 열리는 즉시
   * 제목뿐 아니라 본문(결과 설명)까지 읽고, 스크림을 눌러 실수로 닫히지 않는다.
   * Escape로 취소하는 길은 그대로 남는다.
   */
  role?: 'dialog' | 'alertdialog'
}

export function Modal({ children, className, onClose, open, role = 'dialog', title }: ModalProps) {
  const titleId = useId()
  const descriptionId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const alert = role === 'alertdialog'

  // 부모가 매 렌더 새 onClose를 넘겨도 포커스를 다시 뺏지 않도록 ref로 읽는다.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // 포커스 effect보다 먼저 선언한다 — cleanup 순서 때문이다(BottomSheet와 동일).
  useDialogBackground(open)

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && onCloseRef.current()
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      previousFocus?.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-modal grid place-items-center p-4">
      {alert ? (
        // alertdialog는 배경을 눌러 닫히면 안 된다 — 확인은 명시적 버튼으로만 받는다.
        <div className="absolute inset-0 bg-scrim" />
      ) : (
        <button
          className="absolute inset-0 cursor-default bg-scrim"
          type="button"
          aria-label="모달 닫기"
          onClick={onClose}
          // 포커스 표시가 없는 전체 화면 버튼이라 탭 순서에서 뺀다.
          // 키보드로 닫는 길은 Escape와 닫기 버튼으로 이미 있다.
          tabIndex={-1}
        />
      )}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role이 변수라 정적 분석이 section의 암묵 역할로 판정한다. 실제 값인 dialog·alertdialog는 둘 다 aria-modal을 지원한다 */}
      <section
        className={cn(
          'relative',
          'w-full max-w-lg rounded-[1.25rem] border border-white/18 bg-surface-raised p-6 text-content shadow-raised',
          className,
        )}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={alert ? descriptionId : undefined}
      >
        <header className="mb-4 flex items-center justify-between gap-4">
          <h2 className="m-0 text-xl font-bold" id={titleId}>
            {title}
          </h2>
          <button
            ref={closeRef}
            className="grid size-tap cursor-pointer place-items-center rounded-full bg-transparent text-2xl text-content focus-visible:outline-3 focus-visible:outline-focus"
            type="button"
            aria-label="닫기"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div id={descriptionId}>{children}</div>
      </section>
    </div>
  )
}
