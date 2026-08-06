import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { MyWeeklyRank, WeeklyRankingEntry } from '@/shared/api/rankingApi'
import { cn } from '@/shared/cn'
import { popVariants } from '@/shared/motion'
import { FullRanking } from './FullRanking'
import { Chevron, EmptyNotice, EntryRow, TickerLabel, TickerViewport } from './parts'
import { PANEL_ID } from './shared'

/**
 * narrow에서 이 수 미만이면 흘리지 않고 세워 둔다. 한 명뿐인데 흘리면 같은 이름만 끝없이
 * 되돌아와 "기록이 적다"가 "고장났다"로 읽힌다. 둘부터는 순위가 바뀌며 지나간다.
 */
/**
 * wide 띠. 상위 몇 명을 세워 두고 나머지는 드롭다운으로 넘긴다.
 * <p>
 * 흐르지 않으므로 <b>몇 명이 더 있는지를 글자로 말해야 한다</b> — 흐르는 띠는 기다리면 다음이
 * 나오지만, 세워 둔 띠는 잘린 곳에서 끝난 것처럼 보인다.
 */
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

  // 띠가 사라지거나 목록이 비면 열린 드롭다운도 함께 닫는다. 안 그러면 빈 패널이 남는다.
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
    <div className="relative flex w-[69.4%] items-center gap-3.5">
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
            'flex h-full flex-none cursor-pointer items-center gap-1.5 border-0 bg-transparent px-1 text-xs font-landing-bold transition-colors duration-150 ease-out focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2',
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
            {/* 바깥을 눌러 닫는 길. 모달이 아니므로 스크림을 어둡게 하거나 뒤 화면을 inert로
                잠그지 않는다 — 드롭다운은 랜딩을 계속 쓰면서 곁눈질하는 것이다. */}
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
              // 버튼(오른쪽 끝)에서 자라야 무엇을 눌러 열렸는지가 위치로 읽힌다.
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
