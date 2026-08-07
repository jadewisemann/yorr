import { useEffect, useState } from 'react'

export const TIMER_WARNING_MS = 10_000

export function useCountdown(deadline: number | null) {
  const [remainingMs, setRemainingMs] = useState(() => remainingFrom(deadline))

  useEffect(() => {
    if (deadline === null) {
      setRemainingMs(0)
      return
    }
    const initial = remainingFrom(deadline)
    setRemainingMs(initial)
    if (initial <= 0) return

    let interval: ReturnType<typeof setInterval> | undefined
    const tick = () => setRemainingMs(remainingFrom(deadline))
    const alignMs = initial % 1000 || 1000
    const align = setTimeout(() => {
      tick()
      interval = setInterval(tick, 1000)
    }, alignMs)

    return () => {
      clearTimeout(align)
      if (interval !== undefined) clearInterval(interval)
    }
  }, [deadline])

  return remainingMs
}

export function formatCountdown(remainingMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function remainingFrom(deadline: number | null) {
  if (deadline === null) return 0
  return Math.max(0, deadline - Date.now())
}
