import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useStartGame } from '@/api/useGameApi'
import { useLeaveRoom } from '@/api/useRoomApi'
import { BottomSheet } from '@/components/BottomSheet'
import { Button } from '@/components/Button'
import { type RankedPlayer, ResultRanking } from '@/components/ResultRanking'
import { ScoreMatrix } from '@/components/ScoreMatrix'
import { UPPER_BONUS_POINTS } from '@/domain/scoring'
import type { RoomSnapshot } from '@/realtime/wsEvents'
import { type ActiveRoomSession, useAppStore } from '@/store'

interface GameResultProps {
  session: ActiveRoomSession
  snapshot: RoomSnapshot
}

/** ⑦ 최종 결과. 결과 확인 3초 → 재대결 1탭이 목표다. */
export function GameResult({ session, snapshot }: GameResultProps) {
  const navigate = useNavigate()
  const reset = useAppStore((state) => state.reset)
  const startGame = useStartGame()
  const leaveRoom = useLeaveRoom()
  const [sheetOpen, setSheetOpen] = useState(false)

  const ranked = toRanking(snapshot, session.you)
  const myIndex = ranked.findIndex((player) => player.playerId === session.you)
  const myRank = myIndex >= 0 ? myIndex + 1 : ranked.length
  const me = ranked[myIndex]
  const myBoard = snapshot.game?.scores[session.you]
  const isHost = session.membershipRole === 'host'

  const handleLeave = async () => {
    const left = await leaveRoom.execute(session.roomCode, session.you, session.sessionToken)
    if (!left) return
    reset()
    void navigate({ to: '/', replace: true })
  }

  const handleRematch = async () => {
    if (!isHost) return
    await startGame.execute()
  }

  return (
    <>
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-gutter pt-6 pb-[max(1.875rem,env(safe-area-inset-bottom))] text-content">
        <p aria-live="polite" className="sr-only" role="status">
          게임 종료, {ranked.length}명 중 {myRank}위, {me?.total ?? 0}점
        </p>

        <h1 className="m-0 text-2xl font-bold">{myRank}위</h1>
        <p className="m-0 mt-1 text-[12.5px] text-content-muted">
          {snapshot.game?.roundNumber ?? 12}라운드 종료
        </p>

        <section className="mt-4 flex items-center justify-between gap-4 rounded-panel border-2 border-brand p-4.5">
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-bold">{session.nickname}</p>
            <p className="m-0 mt-1 text-[11px] text-content-muted">
              {myBoard && myBoard.upperBonus >= UPPER_BONUS_POINTS
                ? '상단 보너스 달성'
                : '상단 보너스 미달'}
            </p>
          </div>
          <strong className="font-mono text-[38px] leading-none font-bold tabular-nums">
            {me?.total ?? 0}
          </strong>
        </section>

        <h2 className="mt-5 mb-2 text-xs font-bold text-content-muted">순위</h2>
        <ResultRanking players={ranked} you={session.you} />

        <Button className="mt-3.5 w-full" onClick={() => setSheetOpen(true)} variant="secondary">
          전체 점수표 보기
        </Button>

        <div className="mt-auto grid gap-2 pt-4">
          <Button
            disabled={!isHost}
            loading={startGame.isLoading}
            onClick={handleRematch}
            size="lg"
          >
            같은 멤버로 다시
          </Button>
          <Button loading={leaveRoom.isLoading} onClick={handleLeave} variant="secondary">
            나가기
          </Button>
          {leaveRoom.error && (
            <p className="m-0 text-center text-sm text-danger" role="alert">
              방을 나가지 못했어요: {leaveRoom.error.message}
            </p>
          )}
          <p className="m-0 text-center text-[10.5px] text-content-muted">
            {isHost ? '재대결은 방장이 시작합니다' : '방장이 다시 시작하기를 기다리는 중'}
          </p>
          {startGame.error && (
            <p className="m-0 text-center text-sm text-danger" role="alert">
              다시 시작하지 못했어요: {startGame.error.message}
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

function toRanking(snapshot: RoomSnapshot, you: string): RankedPlayer[] {
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
