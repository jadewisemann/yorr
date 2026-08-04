import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { scrimVariants } from '@/shared/motion'

/**
 * 화면이 바뀌는 동안 덮는 전환 오버레이. 대기실 → 게임, 게임 → 결과처럼 <b>기다리는 것
 * 말고 할 일이 없는</b> 구간에 쓴다.
 *
 * {@link Modal}을 쓰지 않는 이유: Modal은 제목 줄과 닫기 버튼을 전제로 하고 열리는 즉시
 * 포커스를 닫기 버튼에 준다. 닫을 수 없는 상태에 닫기 버튼을 그리게 된다.
 *
 * 기다림에서 <b>빠져나올 길이 하나</b> 있을 때만(빠른 대전 취소 등) `children`에 그 버튼을
 * 넘긴다. 그 이상 담기 시작하면 이건 오버레이가 아니라 화면이다.
 */
export function LoadingOverlay({
  busy = true,
  children,
  message,
  open,
}: {
  /** false면 스피너를 접는다 — 더 이상 진행 중이 아닌 안내(오류 등)에 쓴다. */
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
          <p className="m-0 max-w-80 text-center text-[15px] font-semibold">{message}</p>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
