import { useState } from 'react'
import type { RoomSnapshot } from '@/realtime/wsEvents'
import { isRoomHost } from '@/room/api/roomApi'
import { useReturnToLobby } from '@/room/api/useGameApi'
import { cn } from '@/shared/cn'
import { BottomSheet } from '@/shared/components/BottomSheet'
import { Button } from '@/shared/components/Button'
import { Panel } from '@/shared/components/Panel'
import type { ActiveRoomSession } from '@/store'
import { ResultRanking } from '@/yacht/components/ResultRanking'
import { ScoreMatrix } from '@/yacht/components/ScoreMatrix'
import { toRanking } from '@/yacht/domain/resultRanking'
import { UPPER_BONUS_POINTS } from '@/yacht/domain/scoring'
import { PartyResultDashboard } from './PartyResultDashboard'

interface GameResultProps {
  onLeaveRequest: () => void
  session: ActiveRoomSession
  snapshot: RoomSnapshot
}

export function GameResult({ onLeaveRequest, session, snapshot }: GameResultProps) {
  const [sheetOpen, setSheetOpen] = useState(false)

  const ranked = toRanking(snapshot, session.you)
  const myIndex = ranked.findIndex((player) => player.playerId === session.you)
  const myRank = myIndex >= 0 ? myIndex + 1 : ranked.length
  const me = ranked[myIndex]
  const myBoard = snapshot.game?.scores[session.you]

  if (session.membershipRole === 'dashboard') {
    return (
      <PartyResultDashboard
        onLeaveRequest={onLeaveRequest}
        ranked={ranked}
        session={session}
        snapshot={snapshot}
      />
    )
  }

  return (
    <>
      <main className="relative mx-auto flex h-svh w-full max-w-2xl flex-col overflow-x-hidden px-gutter pt-6 pb-[max(1.875rem,env(safe-area-inset-bottom))] text-content">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 left-1/2 h-[21rem] w-[26rem] -translate-x-1/2 [background:radial-gradient(50%_55%_at_50%_30%,rgb(229_57_53_/_20%)_0%,transparent_72%)]"
        />
        <p aria-live="polite" className="sr-only" role="status">
          게임 종료, {ranked.length}명 중 {myRank}위, {me?.total ?? 0}점
        </p>

        <ResultHeadline
          myRank={myRank}
          playerCount={ranked.length}
          roundNumber={snapshot.game?.roundNumber ?? 12}
        />
        <MyResultCard
          bonusReached={myBoard !== undefined && myBoard.upperBonus >= UPPER_BONUS_POINTS}
          nickname={session.nickname}
          total={me?.total ?? 0}
        />

        <div className="relative mt-6 mb-2 flex items-baseline justify-between">
          <h2 className="m-0 font-mono text-2xs font-bold tracking-[0.14em] text-content-muted uppercase">
            Final Standings
          </h2>
          <span className="text-xs text-content-muted">총점 기준</span>
        </div>
        <ResultRanking
          className="relative min-h-28 flex-1 auto-rows-min content-start overflow-y-auto"
          players={ranked}
          you={session.you}
        />

        <ResultActions
          isHost={isRoomHost(snapshot, session.you)}
          onLeaveRequest={onLeaveRequest}
          onOpenSheet={() => setSheetOpen(true)}
        />
      </main>

      <BottomSheet onClose={() => setSheetOpen(false)} open={sheetOpen} title="전체 점수표">
        <ScoreMatrix
          className="min-h-0 flex-1"
          players={ranked.map((player) => ({
            nickname: player.playerId === session.you ? '나' : player.nickname,
            playerId: player.playerId,
            scoreboard: snapshot.game?.scores[player.playerId],
          }))}
        />
      </BottomSheet>
    </>
  )
}

interface ResultHeadlineProps {
  myRank: number
  playerCount: number
  roundNumber: number
}

function ResultHeadline({ myRank, playerCount, roundNumber }: ResultHeadlineProps) {
  return (
    <>
      <span className="relative inline-flex w-fit items-center gap-2 rounded-full border border-border bg-surface-veil px-3 py-1.5 font-mono text-2xs font-bold tracking-[0.16em] text-content-muted uppercase">
        {roundNumber}라운드 종료
      </span>
      <div className="relative mt-3 flex items-end gap-3">
        <h1 className="m-0 font-mono text-[5.5rem] leading-[0.85] font-bold tracking-[-0.05em]">
          {myRank}
          <span className="font-sans text-[2.25rem] font-bold tracking-[-0.02em]">위</span>
        </h1>
        <span aria-hidden="true" className="pb-1.5 text-sm text-content-muted">
          {playerCount}명 중
        </span>
      </div>
    </>
  )
}

interface MyResultCardProps {
  bonusReached: boolean
  nickname: string
  total: number
}

function MyResultCard({ bonusReached, nickname, total }: MyResultCardProps) {
  return (
    <Panel
      as="section"
      className="relative mt-5 flex items-center justify-between gap-4 border-border-strong p-4.5"
      surface="raised"
    >
      <div className="min-w-0">
        <p className="m-0 flex items-center gap-2 truncate text-base font-bold">
          {nickname}
          <span className="rounded-chip bg-content px-1.5 py-0.5 font-mono text-2xs font-bold tracking-[0.1em] text-canvas">
            ME
          </span>
        </p>
        <p
          className={cn(
            'm-0 mt-1.5 text-xs',
            bonusReached ? 'text-positive' : 'text-content-muted',
          )}
        >
          {bonusReached ? `상단 보너스 +${UPPER_BONUS_POINTS} 달성` : '상단 보너스 미달'}
        </p>
      </div>
      <strong className="font-mono text-4xl leading-none font-bold tabular-nums">{total}</strong>
    </Panel>
  )
}

interface ResultActionsProps {
  isHost: boolean
  onLeaveRequest: () => void
  onOpenSheet: () => void
}

/** 결과 화면 아래 버튼 묶음 — 대기실 복귀 요청은 방장만 보낼 수 있다. */
function ResultActions({ isHost, onLeaveRequest, onOpenSheet }: ResultActionsProps) {
  const returnToLobby = useReturnToLobby()

  const handleReturnToLobby = async () => {
    if (!isHost) return
    await returnToLobby.execute()
  }

  return (
    <div className="relative grid flex-none gap-2 border-t border-border pt-4">
      <Button className="w-full" onClick={onOpenSheet} variant="ghost">
        전체 점수표 보기
      </Button>
      <Button
        disabled={!isHost}
        loading={returnToLobby.isLoading}
        onClick={handleReturnToLobby}
        size="cta"
      >
        대기실로
      </Button>
      <Button
        className="text-content-muted hover:text-content"
        onClick={onLeaveRequest}
        variant="ghost"
      >
        나가기
      </Button>
      <p className="m-0 text-center text-2xs text-content-muted">
        {isHost
          ? '대기실로 돌아가면 같은 멤버로 다시 시작할 수 있어요'
          : '방장이 대기실로 옮기기를 기다리는 중'}
      </p>
      {returnToLobby.error && (
        <p className="m-0 text-center text-sm text-danger" role="alert">
          대기실로 돌아가지 못했어요: {returnToLobby.error.message}
        </p>
      )}
    </div>
  )
}
