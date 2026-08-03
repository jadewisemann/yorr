import { useEffect, useState } from 'react'

/**
 * 레이아웃 구조 자체가 갈릴 때만 쓴다. 스타일만 다른 경우는 Tailwind breakpoint로 충분하다.
 * 랜딩은 데스크톱/모바일이 DOM 구조가 달라서(세로 목록 ↔ 칩 레일, id 중복 회피) JS 분기가 필요하다.
 */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mediaQuery = window.matchMedia(query)
    const sync = () => setMatches(mediaQuery.matches)
    sync()
    mediaQuery.addEventListener('change', sync)
    return () => mediaQuery.removeEventListener('change', sync)
  }, [query])

  return matches
}
