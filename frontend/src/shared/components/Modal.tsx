import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useEffectEvent, useId, useRef } from 'react'
import { cn } from '@/shared/cn'
import { IconClose } from '@/shared/components/Icon'
import { popVariants, scrimVariants } from '@/shared/motion'
import { useDialogBackground } from '@/shared/useDialogBackground'

type ModalProps = {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
  className?: string
  role?: 'dialog' | 'alertdialog'
}

export function Modal({ children, className, onClose, open, role = 'dialog', title }: ModalProps) {
  const titleId = useId()
  const descriptionId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const alert = role === 'alertdialog'

  const close = useEffectEvent(onClose)

  useDialogBackground(open)

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && close()
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      previousFocus?.focus()
    }
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-modal grid place-items-center p-4">
          {alert ? (
            <motion.div
              animate="visible"
              className="absolute inset-0 bg-scrim"
              exit="exit"
              initial="hidden"
              variants={scrimVariants}
            />
          ) : (
            <motion.button
              animate="visible"
              aria-label="모달 닫기"
              className="absolute inset-0 cursor-default bg-scrim"
              exit="exit"
              initial="hidden"
              onClick={onClose}
              tabIndex={-1}
              type="button"
              variants={scrimVariants}
            />
          )}
          <motion.section
            animate="visible"
            aria-describedby={alert ? descriptionId : undefined}
            aria-labelledby={titleId}
            aria-modal="true"
            className={cn(
              'relative',
              'w-full max-w-lg rounded-panel border border-border-strong bg-surface-raised p-6 text-content shadow-raised',
              className,
            )}
            exit="exit"
            initial="hidden"
            role={role}
            variants={popVariants}
          >
            <header className="mb-4 flex items-center justify-between gap-4">
              <h2 className="m-0 text-xl font-bold" id={titleId}>
                {title}
              </h2>
              <button
                ref={closeRef}
                className="grid size-tap cursor-pointer place-items-center rounded-full bg-transparent text-content focus-ring pressable"
                type="button"
                aria-label="닫기"
                onClick={onClose}
              >
                <IconClose className="size-5" />
              </button>
            </header>
            <div id={descriptionId}>{children}</div>
          </motion.section>
        </div>
      )}
    </AnimatePresence>
  )
}
