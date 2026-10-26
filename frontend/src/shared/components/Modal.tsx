import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useId, useRef } from 'react'
import { cn } from '@/shared/cn'
import { DialogScrim } from '@/shared/components/DialogScrim'
import { IconClose } from '@/shared/components/Icon'
import { popVariants, scrimVariants } from '@/shared/motion'
import { useDialogBackground } from '@/shared/useDialogBackground'
import { useDialogFocus } from '@/shared/useDialogFocus'

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

  useDialogBackground(open)
  useDialogFocus(open, {
    initialFocus: () => closeRef.current,
    onKeyDown: (event) => {
      if (event.key === 'Escape') onClose()
    },
  })

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
            <DialogScrim
              className="absolute inset-0 cursor-default bg-scrim"
              label="모달 닫기"
              onClose={onClose}
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
