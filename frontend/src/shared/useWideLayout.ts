import { useMediaQuery } from './useMediaQuery'

const WIDE_LAYOUT = '(min-width: 1024px)'

export function useWideLayout() {
  return useMediaQuery(WIDE_LAYOUT)
}
