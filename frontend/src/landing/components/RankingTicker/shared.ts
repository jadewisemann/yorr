import { useEffect, useEffectEvent } from 'react'

export const PANEL_ID = 'weekly-ranking-panel'

export const SECONDS_PER_ENTRY = 4.5

export const MIN_SCROLL_ENTRIES = 2

export function useCloseOnEscape(open: boolean, onClose: () => void) {
  const close = useEffectEvent(onClose)

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])
}
