import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { MyWeeklyRank, WeeklyRankingEntry } from '@/shared/api/rankingApi'
import { cn } from '@/shared/cn'
import { popVariants } from '@/shared/motion'
import { FullRanking } from './FullRanking'
import { Chevron, EmptyNotice, EntryRow, TickerLabel, TickerViewport } from './parts'
import { PANEL_ID } from './shared'

export function WideBand({
  band,
  entries,
  loading,
  myNickname,
  myRank,
  myUserId,
}: {
  band: WeeklyRankingEntry[]
  entries: WeeklyRankingEntry[]
  loading: boolean
  myNickname: string | null
  myRank: MyWeeklyRank | null
  myUserId: string | null
}) {
  const [open, setOpen] = useState(false)
  const hidden = entries.length - band.length

  useEffect(() => {
    if (entries.length === 0) setOpen(false)
  }, [entries.length])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  return (
    <div className="relative flex w-[69.4%] items-center gap-3">
      <TickerLabel />
      <TickerViewport>
        {band.length === 0 ? (
          <EmptyNotice loading={loading} />
        ) : (
          <EntryRow entries={band} myUserId={myUserId} />
        )}
      </TickerViewport>

      {entries.length > 0 && (
        <button
          aria-controls={PANEL_ID}
          aria-expanded={open}
          className={cn(
            'flex h-full flex-none cursor-pointer items-center gap-1.5 border-0 bg-transparent px-1 text-xs font-landing-bold transition-colors duration-150 ease-out focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2 pressable',
            open ? 'text-landing-accent-text' : 'text-landing-text-muted hover:text-landing-text',
          )}
          onClick={() => setOpen((previous) => !previous)}
          type="button"
        >
          {hidden > 0 ? `+${hidden}명 전체 보기` : '전체 보기'}
          <Chevron open={open} />
        </button>
      )}

      <AnimatePresence>
        {open && (
          <>
            <button
              aria-label="랭킹 닫기"
              className="fixed inset-0 z-banner cursor-default border-0 bg-transparent"
              onClick={() => setOpen(false)}
              tabIndex={-1}
              type="button"
            />
            <motion.div
              animate="visible"
              className="absolute top-full right-0 z-banner mt-2.5 w-90 rounded-panel border border-landing-hairline-strong bg-surface-raised p-2 shadow-landing-popover"
              exit="exit"
              id={PANEL_ID}
              initial="hidden"
              style={{ transformOrigin: 'top right' }}
              variants={popVariants}
            >
              <FullRanking
                entries={entries}
                myNickname={myNickname}
                myRank={myRank}
                myUserId={myUserId}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
