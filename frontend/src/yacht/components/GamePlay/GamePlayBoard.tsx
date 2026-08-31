import type { ReactNode } from 'react'
import type { Player } from '@/realtime/wsEvents'
import { cn } from '@/shared/cn'
import { ConnectionBanner } from '@/shared/components/ConnectionBanner'
import { PlayBoard } from '@/shared/components/Screen'
import { ReactionDock } from '@/yacht/components/ReactionDock'
import { RecordPanel } from '@/yacht/components/RecordPanel'

interface GamePlayBoardProps {
  actions: ReactNode
  /** 좁은 화면에서 판 위에 잠깐 떠오르는 새 대화. 넓은 화면은 `chatPanel`이 대신한다. */
  chatToast?: ReactNode
  /** 넓은 화면에서 점수표 아래에 상주하는 채팅. 좁은 화면에서는 자리가 없어 넘기지 않는다. */
  chatPanel?: ReactNode
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
  chatToast,
  chatPanel,
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
          {chatToast}
          {guideOverlay}
          <footer
            className={cn(
              'flex flex-none items-center px-gutter',
              wide
                ? // 안내문은 트레이 하단 가운데에 있다 — 푸터에는 버튼만 가운데에 남는다.
                  'justify-center gap-4 border-t border-border py-4'
                : 'gap-2 pt-2 pb-[calc(8.75rem+env(safe-area-inset-bottom))]',
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

      {/*
       * 넓은 화면의 오른쪽 열은 점수표와 채팅이 나눠 쓴다 — 점수표가 남는 높이를 갖고 채팅은
       * 아래에서 고정 높이를 지킨다. 대화가 쌓인다고 점수표가 줄어들면 안 된다.
       *
       * 그 대가로 720px 높이에서는 점수표 하단 족보가 스크롤 안으로 들어간다(`ScoreSheet`가
       * overflow-auto라 굴려서 본다). 채팅을 상주시키기로 한 이상 오른쪽 열 어딘가는 줄어야
       * 하고, 굴려서 볼 수 있는 쪽이 점수표다 — 대화는 마지막 줄이 늘 보여야 한다.
       */}
      {wide ? (
        <div className="flex min-h-0 flex-col border-l border-border">
          {scoreSheet(
            'min-h-0 flex-1',
            <div className="flex items-baseline justify-between gap-3 px-3 pt-2.5 pb-1.5">
              <h2 className="m-0 text-sm font-bold tracking-[0.02em] whitespace-nowrap">점수표</h2>
              <p className="m-0 truncate text-xs text-content-faint">{sheetHint}</p>
            </div>,
          )}
          {chatPanel}
        </div>
      ) : null}
    </PlayBoard>
  )
}
