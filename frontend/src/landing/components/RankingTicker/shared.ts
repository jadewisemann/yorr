import { useEffect, useEffectEvent, useState } from 'react'
import type { MyWeeklyRank, WeeklyRankingEntry } from '@/shared/api/rankingApi'

export const PANEL_ID = 'weekly-ranking-panel'

export const SECONDS_PER_ENTRY = 4.5

export const MIN_SCROLL_ENTRIES = 2

/** 펼쳐진 동안 Esc로 닫는다. `useBandDisclosure`가 두 띠를 대신해 부른다. */
function useCloseOnEscape(open: boolean, onClose: () => void) {
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

/** 좁은 띠와 넓은 띠가 같은 자료를 받는다 — 다른 것은 몇 명을 띠에 보이느냐뿐이다. */
export interface BandProps {
  /** 띠에 실제로 보이는 몫. 나머지는 펼친 목록에서 본다. */
  band: WeeklyRankingEntry[]
  entries: WeeklyRankingEntry[]
  loading: boolean
  myNickname: string | null
  myRank: MyWeeklyRank | null
  myUserId: string | null
}

/**
 * 띠를 펼치고 접는 상태. 순위가 하나도 없으면 펼침을 거두고, 펼쳐진 동안에는 Esc로
 * 닫힌다 — 두 띠가 같은 규약을 지켜야 하므로 여기 한자리에 둔다.
 */
export function useBandDisclosure(entryCount: number) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (entryCount === 0) setOpen(false)
  }, [entryCount])

  useCloseOnEscape(open, () => setOpen(false))

  return { open, setOpen }
}
