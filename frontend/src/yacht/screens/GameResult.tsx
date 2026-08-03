import { useState } from 'react'
import type { RoomSnapshot } from '@/realtime/wsEvents'
import { hasHostPowers } from '@/room/api/roomApi'
// 경계 규칙 예외 — yacht가 room을 본다. 결과 화면이 "대기실로 돌아가기"를 직접
// 호출하기 때문이다. 부모인 room/screens/GamePage가 onLeaveRequest처럼 콜백으로
// 내려주면 사라지지만 컴포넌트 계약이 바뀌는 로직 변경이라 별도 티켓이다.
import { useReturnToLobby } from '@/room/api/useGameApi'
import { cn } from '@/shared/cn'
import { BottomSheet } from '@/shared/components/BottomSheet'
import { Button } from '@/shared/components/Button'
import type { ActiveRoomSession } from '@/store'
import { type RankedPlayer, ResultRanking } from '@/yacht/components/ResultRanking'
import { ScoreMatrix } from '@/yacht/components/ScoreMatrix'
import { UPPER_BONUS_POINTS } from '@/yacht/domain/scoring'

interface GameResultProps {
  /** 나가기는 GamePage의 RoomExitGuard가 확인을 받고 처리한다(GamePlay와 같은 경로). */
  onLeaveRequest: () => void
  session: ActiveRoomSession
  snapshot: RoomSnapshot
}

/** ⑦ 최종 결과. 결과 확인 3초 → 재대결 1탭이 목표다. */
export function GameResult({ onLeaveRequest, session, snapshot }: GameResultProps) {
  const returnToLobby = useReturnToLobby()
  const [sheetOpen, setSheetOpen] = useState(false)

  const ranked = toRanking(snapshot, session.you)
  const myIndex = ranked.findIndex((player) => player.playerId === session.you)
  const myRank = myIndex >= 0 ? myIndex + 1 : ranked.length
  const me = ranked[myIndex]
  const myBoard = snapshot.game?.scores[session.you]
  const isHost = hasHostPowers(session.membershipRole)

  // 대기실 복귀는 방 전체가 함께 움직인다(화면 전환이 phase 기준이라 혼자 옮겨갈 수 없다).
  // 이동 자체는 서버의 state.sync를 받은 라우팅이 처리하므로 여기서 navigate하지 않는다.
  const handleReturnToLobby = async () => {
    if (!isHost) return
    await returnToLobby.execute()
  }

  return (
    <>
      {/* 뷰포트 높이로 프레임을 고정하고 페이지 스크롤을 막는다 — 인원이 많아져도
          스크롤은 아래 랭킹 목록 안에서만 일어난다(QA FND-6, LobbyPage·GamePlay와 같은 패턴). */}
      <main className="relative mx-auto flex h-svh w-full max-w-2xl flex-col overflow-hidden px-gutter pt-6 pb-[max(1.875rem,env(safe-area-inset-bottom))] text-content">
        {/* 디자인 08 — 상단에서 은은하게 퍼지는 레드 글로우. 정보가 아니라 분위기다. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 left-1/2 h-[21rem] w-[26rem] -translate-x-1/2 [background:radial-gradient(50%_55%_at_50%_30%,rgb(229_57_53_/_20%)_0%,transparent_72%)]"
        />
        <p aria-live="polite" className="sr-only" role="status">
          게임 종료, {ranked.length}명 중 {myRank}위, {me?.total ?? 0}점
        </p>

        <span className="relative inline-flex w-fit items-center gap-2 rounded-full border border-border bg-white/6 px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.16em] text-content-muted uppercase">
          {snapshot.game?.roundNumber ?? 12}라운드 종료
        </span>
        <div className="relative mt-3 flex items-end gap-3">
          <h1 className="m-0 font-mono text-[5.5rem] leading-[0.85] font-bold tracking-[-0.05em]">
            {myRank}
            <span className="font-sans text-[2.25rem] font-bold tracking-[-0.02em]">위</span>
          </h1>
          <span aria-hidden="true" className="pb-1.5 text-sm text-content-muted">
            {ranked.length}명 중
          </span>
        </div>

        <section className="relative mt-5 flex items-center justify-between gap-4 rounded-[1.25rem] border border-white/18 bg-surface-raised p-4.5">
          <div className="min-w-0">
            <p className="m-0 flex items-center gap-2 truncate text-[17px] font-bold">
              {session.nickname}
              <span className="rounded-[6px] bg-content px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.1em] text-canvas">
                ME
              </span>
            </p>
            <p
              className={cn(
                'm-0 mt-1.5 text-[13px]',
                myBoard && myBoard.upperBonus >= UPPER_BONUS_POINTS
                  ? 'text-positive'
                  : 'text-content-muted',
              )}
            >
              {myBoard && myBoard.upperBonus >= UPPER_BONUS_POINTS
                ? `상단 보너스 +${UPPER_BONUS_POINTS} 달성`
                : '상단 보너스 미달'}
            </p>
          </div>
          <strong className="font-mono text-[38px] leading-none font-bold tabular-nums">
            {me?.total ?? 0}
          </strong>
        </section>

        <div className="relative mt-6 mb-2 flex items-baseline justify-between">
          <h2 className="m-0 font-mono text-[11px] font-bold tracking-[0.14em] text-content-muted uppercase">
            Final Standings
          </h2>
          <span className="text-[13px] text-content-muted">총점 기준</span>
        </div>
        {/* min-h-0 + overflow-y-auto: 랭킹이 늘어나도 스크롤은 이 목록 안에서만 일어난다 —
            내 점수 카드·하단 버튼은 항상 고정 위치에 남는다(QA FND-6). */}
        <ResultRanking
          className="relative min-h-0 flex-1 auto-rows-min content-start overflow-y-auto"
          players={ranked}
          you={session.you}
        />

        <div className="relative grid flex-none gap-2 border-t border-border pt-4">
          <Button className="w-full" onClick={() => setSheetOpen(true)} variant="ghost">
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
          <p className="m-0 text-center text-[10.5px] text-content-muted">
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

/**
 * 순위는 서버가 game.over로 보낸 값을 그대로 쓴다(총점도 서버 확정값). 로컬 재계산은
 * score.update를 하나라도 놓치면 서버와 다른 등수를 보여주므로 폴백으로만 남긴다.
 */
function toRanking(snapshot: RoomSnapshot, you: string): RankedPlayer[] {
  const serverRankings = snapshot.game?.rankings
  if (serverRankings && serverRankings.length > 0) {
    const nicknameById = new Map(
      snapshot.players.map((player) => [player.playerId, player.nickname]),
    )
    return serverRankings.map((ranking) => ({
      nickname: nicknameById.get(ranking.playerId) ?? '알 수 없는 참가자',
      playerId: ranking.playerId,
      total: ranking.total,
    }))
  }

  return snapshot.players
    .map((player) => ({
      nickname: player.nickname,
      playerId: player.playerId,
      total: snapshot.game?.scores[player.playerId]?.total ?? 0,
    }))
    .sort((left, right) => {
      if (right.total !== left.total) return right.total - left.total
      // 동점이면 내 자리를 위로 올려 스스로 찾기 쉽게 한다.
      if (left.playerId === you) return -1
      if (right.playerId === you) return 1
      return 0
    })
}
