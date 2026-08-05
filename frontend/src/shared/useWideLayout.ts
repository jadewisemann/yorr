import { useMediaQuery } from './useMediaQuery'

/**
 * 게임판이 2열로 갈리는 폭. GamePlay·PartyDashboardPage·PartyResultDashboard가 각자
 * 같은 문자열을 선언하고 있었다 — 한쪽만 고치면 세 화면의 레이아웃이 서로 어긋난다.
 */
const WIDE_LAYOUT = '(min-width: 1024px)'

export function useWideLayout() {
  return useMediaQuery(WIDE_LAYOUT)
}
