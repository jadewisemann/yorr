import { AnimatePresence, motion } from 'motion/react'
import { scrimVariants } from '@/shared/motion'

/**
 * 화면이 바뀌는 동안 덮는 전환 오버레이. 대기실 → 게임, 게임 → 결과처럼 <b>기다리는 것
 * 말고 할 일이 없는</b> 구간에 쓴다.
 *
 * {@link Modal}을 쓰지 않는 이유: Modal은 제목 줄과 닫기 버튼을 전제로 하고 열리는 즉시
 * 포커스를 닫기 버튼에 준다. 닫을 수 없는 상태에 닫기 버튼을 그리게 된다.
 */
export function LoadingOverlay({ message, open }: { message: string; open: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          animate="visible"
          aria-busy="true"
          aria-live="polite"
          className="fixed inset-0 z-modal flex flex-col items-center justify-center gap-4 bg-scrim p-6 text-content backdrop-blur-[2px]"
          exit="exit"
          initial="hidden"
          role="status"
          variants={scrimVariants}
        >
          <span
            aria-hidden="true"
            className="size-9 animate-spin-slow rounded-full border-3 border-current border-r-transparent motion-reduce:animate-none"
          />
          <p className="m-0 text-[15px] font-semibold">{message}</p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
