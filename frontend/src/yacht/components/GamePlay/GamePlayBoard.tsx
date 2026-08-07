import type { ReactNode } from 'react'
import type { Player } from '@/realtime/wsEvents'
import { cn } from '@/shared/cn'
import { ConnectionBanner } from '@/shared/components/ConnectionBanner'
import { PlayBoard } from '@/shared/components/Screen'
import { ReactionDock } from '@/yacht/components/ReactionDock'
import { RecordPanel } from '@/yacht/components/RecordPanel'

interface GamePlayBoardProps {
  actions: ReactNode
  connectionStatus: Parameters<typeof ConnectionBanner>[0]['status']
  diceScene: ReactNode
  guideOverlay: ReactNode
  header: ReactNode
  openCount: number
  players: Player[]
  quickStrip: ReactNode
  recordTitle: string
  scoreSheet: (className: string, header?: ReactNode) => ReactNode
  sheetHint: string
  sheetOpen: boolean
  onSheetToggle: (open: boolean) => void
  turnStrip: ReactNode
  wide: boolean
}

export function GamePlayBoard({
  actions,
  connectionStatus,
  diceScene,
  guideOverlay,
  header,
  openCount,
  players,
  quickStrip,
  recordTitle,
  scoreSheet,
  sheetHint,
  sheetOpen,
  onSheetToggle,
  turnStrip,
  wide,
}: GamePlayBoardProps) {
  return (
    <PlayBoard wide={wide}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="absolute inset-x-0 top-0 z-banner pt-[calc(0.5rem+env(safe-area-inset-top))] has-[p]:bg-canvas">
          <ConnectionBanner status={connectionStatus} />
        </div>
        {header}
        {turnStrip}

        <div className={cn('flex min-h-0 flex-1 flex-col', !wide && 'relative')}>
          {diceScene}
          {guideOverlay}
          <footer
            className={cn(
              'flex flex-none items-center px-gutter',
              wide
                ? // 안내문은 트레이 하단 가운데에 있다 — 푸터에는 버튼만 가운데에 남는다.
                  'justify-center gap-4 border-t border-border py-4'
                : 'gap-2.5 pt-2 pb-[calc(8.75rem+env(safe-area-inset-bottom))]',
            )}
          >
            {actions}
          </footer>

          {wide ? null : (
            <RecordPanel
              onToggle={onSheetToggle}
              open={sheetOpen}
              quick={quickStrip}
              subtitle={`${openCount}개 남음`}
              title={recordTitle}
            >
              {scoreSheet('h-full')}
            </RecordPanel>
          )}
        </div>

        <ReactionDock
          className={cn(
            'absolute right-gutter z-sticky',
            wide ? 'bottom-[6.75rem]' : 'bottom-[calc(13.25rem+env(safe-area-inset-bottom))]',
          )}
          players={players}
        />
      </div>

      {wide
        ? scoreSheet(
            'min-h-0 border-l border-border',
            <div className="flex items-baseline justify-between gap-3 px-3 pt-2.5 pb-1.5">
              <h2 className="m-0 text-sm font-bold tracking-[0.02em] whitespace-nowrap">점수표</h2>
              <p className="m-0 truncate text-xs text-content-faint">{sheetHint}</p>
            </div>,
          )
        : null}
    </PlayBoard>
  )
}
