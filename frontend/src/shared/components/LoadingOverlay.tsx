import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { scrimVariants } from '@/shared/motion'

export function LoadingOverlay({
  busy = true,
  children,
  message,
  open,
}: {
  busy?: boolean
  children?: ReactNode
  message: string
  open: boolean
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          animate="visible"
          aria-busy={busy || undefined}
          aria-live="polite"
          className="fixed inset-0 z-modal flex flex-col items-center justify-center gap-4 bg-scrim p-6 text-content backdrop-blur-[2px]"
          exit="exit"
          initial="hidden"
          role="status"
          variants={scrimVariants}
        >
          {busy && (
            <span
              aria-hidden="true"
              className="size-9 animate-spin-slow rounded-full border-3 border-current border-r-transparent motion-reduce:animate-none"
            />
          )}
          <p className="m-0 max-w-80 text-center text-sm font-semibold">{message}</p>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
