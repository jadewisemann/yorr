import type { Transition, Variants } from 'motion/react'

export const DURATION = {
  fast: 0.12,
  base: 0.22,
} as const

export const EASE_SNAPPY = [0.2, 0, 0, 1] as const
export const EASE_EXIT = [0.4, 0, 1, 1] as const

export const ENTER: Transition = { duration: DURATION.base, ease: EASE_SNAPPY }
export const EXIT: Transition = { duration: DURATION.fast, ease: EASE_EXIT }

export const sheetVariants: Variants = {
  hidden: { y: '100%' },
  visible: { y: 0, transition: ENTER },
  exit: { y: '100%', transition: EXIT },
}

export const popVariants: Variants = {
  hidden: { opacity: 0, scale: 0.97 },
  visible: { opacity: 1, scale: 1, transition: ENTER },
  exit: { opacity: 0, scale: 0.97, transition: EXIT },
}

export const scrimVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: ENTER },
  exit: { opacity: 0, transition: EXIT },
}
