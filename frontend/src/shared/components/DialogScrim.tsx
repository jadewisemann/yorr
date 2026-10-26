import { motion } from 'motion/react'
import { scrimVariants } from '@/shared/motion'

interface DialogScrimProps {
  className?: string
  label: string
  onClose: () => void
}

/**
 * Modal·Popover·BottomSheet 뒤에 까는 배경. 누르면 닫히는 버튼이지만 탭 순서에서는 빠진다 —
 * 키보드는 Escape로 닫는다.
 */
export function DialogScrim({
  className = 'absolute inset-0 cursor-default border-0 bg-scrim',
  label,
  onClose,
}: DialogScrimProps) {
  return (
    <motion.button
      animate="visible"
      aria-label={label}
      className={className}
      exit="exit"
      initial="hidden"
      onClick={onClose}
      tabIndex={-1}
      type="button"
      variants={scrimVariants}
    />
  )
}
