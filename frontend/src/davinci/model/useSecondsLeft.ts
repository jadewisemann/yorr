import { useEffect, useState } from 'react'

const secondsFrom = (deadline: number): number =>
  deadline <= 0 ? 0 : Math.max(0, Math.ceil((deadline - Date.now()) / 1000))

/**
 * 마감까지 남은 초. 마감이 없으면(`0`) 0을 돌려주고 화면은 타이머를 그리지 않는다.
 *
 * 야추의 `useCountdown`을 쓰지 않는 이유는 그 훅이 `yacht/model/`(도메인 비공개
 * 세그먼트)에 있어 도메인 밖에서 import할 수 없기 때문이다(DESIGN.md 원칙 4).
 * 필요한 것도 그쪽의 `분:초` 표기가 아니라 "몇 초 남았나" 하나뿐이다 — 다빈치 코드의
 * 마감은 길어야 30초라 분 자리가 영원히 0이다.
 */
export function useSecondsLeft(deadline: number): number {
  const [seconds, setSeconds] = useState(() => secondsFrom(deadline))

  useEffect(() => {
    setSeconds(secondsFrom(deadline))
    if (deadline <= 0) return
    const interval = setInterval(() => setSeconds(secondsFrom(deadline)), 250)
    return () => clearInterval(interval)
  }, [deadline])

  return seconds
}
