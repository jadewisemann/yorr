import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/cn'

const TOAST_DURATION_MS = 2_500

/** 동시에 하나만 띄운다. 새 토스트가 오면 이전 것을 즉시 대체한다(와이어프레임 1d). */
export function useToast() {
  const [message, setMessage] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const showToast = useCallback((next: string) => {
    setMessage(next)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setMessage(null), TOAST_DURATION_MS)
  }, [])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  return { message, showToast }
}

interface ToastHostProps {
  className?: string
  message: string | null
}

export function ToastHost({ className, message }: ToastHostProps) {
  return (
    <div
      aria-live="polite"
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-0 z-toast flex justify-center px-gutter pb-[calc(env(safe-area-inset-bottom)+5.5rem)]',
        className,
      )}
      role="status"
    >
      {message && (
        <p className="m-0 max-w-md rounded-card border border-border bg-[#202125] px-4 py-3 text-center text-sm font-semibold text-content shadow-raised">
          {message}
        </p>
      )}
    </div>
  )
}
