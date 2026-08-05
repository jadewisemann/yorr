import { useEffect, useState } from 'react'

/** 남은 시간이 이 값 이하로 떨어지면 경고 표시로 전환한다(와이어프레임 1d). */
export const TIMER_WARNING_MS = 10_000

/**
 * deadline(epoch ms)에서 남은 시간을 계산한다.
 * 서버는 tick 이벤트를 보내지 않고 deadline만 내려주므로 계산은 전적으로 클라 몫이다.
 *
 * 표시 단위가 초이므로 초 경계에 맞춰서만 갱신한다.
 * 250ms로 돌리면 네 번 중 세 번은 같은 화면을 다시 그리는 낭비가 된다.
 */
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
    // 다음 초 경계까지 기다렸다가 1초 간격으로 맞춘다.
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
