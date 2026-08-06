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
  /** 연습 모드 안내 오버레이. 흐름에서 자리를 차지하지 않는다. */
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

/**
 * 게임판 레이아웃. 조각은 화면(`GamePlay`)이 만들고 이 컴포넌트가 자리에 놓는다 —
 * 넓이별 배치와 겹침 순서가 여기 한곳에 모인다.
 */
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
    <>
      {/* 뷰포트 높이로 고정하고 페이지 스크롤을 막는다 — 스크롤은 점수시트 내부에서만 일어난다.
          폭은 max-w-play에서 멈추고 가운데 선다. 이 값은 상수가 아니라 뷰포트 높이별 3단이다 —
          3D 트레이의 직교 카메라가 높이로 스케일되므로(World.ts resize) 쓸 수 있는 가로도
          높이를 따라간다. 72rem 상수였을 때 트레이가 592px에 고정된 채 높이만 자라
          1728×1000에서 arena 좌우가 14% 잘리고 있었다.
          시트 28rem — 6인(정원) 최소 27.5rem(라벨 8rem + 6×2.75rem + 거터·갭)에 맞춘 값이다.
          32.5rem은 80px 과잉이었고 그만큼을 트레이에 넘긴다.
          minmax(0,1fr): 그냥 1fr은 minmax(auto,1fr)이라 TurnStrip 6인이 왼쪽 열 최소 폭을
          밀어올릴 수 있다. */}
      <PlayBoard wide={wide}>
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* 배너는 오버레이로 띄운다 — 플로우에 끼우면 나타날 때마다 3D 트레이 크기를 밀어
              씬이 리사이즈된다. 연결 상태는 일시적이라 헤더를 잠깐 덮는 쪽이 낫다.

              덮을 것이라면 불투명해야 한다. 배너 자신의 배경은 상태 색 틴트(예: bg-warning/12)라
              그것만으로는 아래 헤더 글자가 그대로 배어 나와 배너와 헤더가 서로를 못 읽게 만든다
              (320·412px 양쪽에서 확인). 그래서 불투명한 판을 한 장 뒤에 깐다.
              has-[p]: 배너는 live region 유지를 위해 항상 마운트되고 문구가 있을 때만 <p>를
              그린다 — 그 조건을 그대로 읽어 덮을 때만 판이 생긴다. */}
          <div className="absolute inset-x-0 top-0 z-banner pt-[calc(0.5rem+env(safe-area-inset-top))] has-[p]:bg-canvas">
            {/* closed면 조작이 전부 잠겼다는 유일한 시각 신호다 — 노치 아래로 들어가면 안 된다. */}
            <ConnectionBanner status={connectionStatus} />
          </div>
          {header}
          {turnStrip}

          {/* 모바일 기록 패널이 이 컨테이너 아래에 붙는다 — 주사위 씬은 항상 같은 자리다. */}
          <div className={cn('flex min-h-0 flex-1 flex-col', !wide && 'relative')}>
            {diceScene}
            {/* 연습 모드 안내. 스스로 뷰포트를 덮는 오버레이라 흐름에서 자리를 차지하지 않는다 —
                감싸는 층을 두면 그 패딩만큼 트레이가 이유 없이 줄어든다. */}
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

          {/* 리액션은 트레이 우하단에 띄운다 — 푸터에 끼우면 안 된다. 리액션을 가장 많이 쓰는
              순간은 "남의 턴"인데 그때 푸터는 WaitingNotice가 차지한다.
              모바일 bottom: 푸터 pb 8.75rem + CTA 높이 3.75rem = 12.5rem 위가 CTA 상단이다.
              그 위로 0.75rem 띄운다 — 9.25rem이었을 때 굴리기 버튼 오른쪽 끝을 덮고 있었다.
              접힌 기록 패널(8.5rem)도 이 값이면 함께 넘긴다.
              z-sticky라 기록 패널(z-sheet)을 펼치면 그 아래로 가려진다 — 의도한 순서다. */}
          {/* 마이크는 여기 없다 — 트레이 위에 버튼이 둘 겹치면 주사위가 답답하다.
              소리 관련 조작은 헤더의 오디오 말풍선 한 곳으로 모았다(AudioPopover). */}
          <ReactionDock
            className={cn(
              'absolute right-gutter z-sticky',
              wide ? 'bottom-[6.75rem]' : 'bottom-[calc(13.25rem+env(safe-area-inset-bottom))]',
            )}
            players={players}
          />
        </div>

        {/* 디자인 Yacht Play 3D — 점수표는 우측 상시 패널이다.
            ScoreSheet 자체가 섹션이자 스크롤 컨테이너라 밖에서 한 번 더 감싸지 않는다 —
            그러면 헤더가 스크롤 영역 밖에 서서 표와 사이가 벌어진다. 헤더를 안으로 넣어
            열 머리와 한 덩어리로 고정시킨다. */}
        {wide
          ? scoreSheet(
              'min-h-0 border-l border-border',
              <div className="flex items-baseline justify-between gap-3 px-3 pt-2.5 pb-1.5">
                <h2 className="m-0 text-sm font-bold tracking-[0.02em] whitespace-nowrap">
                  점수표
                </h2>
                <p className="m-0 truncate text-xs text-content-faint">{sheetHint}</p>
              </div>,
            )
          : null}
      </PlayBoard>
    </>
  )
}
