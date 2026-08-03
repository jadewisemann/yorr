import { useNavigate } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useGame } from '@/room/api/useGameApi'
import { playGameSoundtrack, playResultSoundtrack } from '@/shared/audio/soundtrack'
import { useAppStore } from '@/store'
import { GamePlay } from '@/yacht/screens/GamePlay'
import { GameResult } from '@/yacht/screens/GameResult'
import { RoomExitGuard } from './RoomExitGuard'

const PingPongGame = lazy(() =>
  import('@/pingpong/PingPongGame').then((module) => ({ default: module.PingPongGame })),
)
const PingPongResult = lazy(() =>
  import('@/pingpong/PingPongGame').then((module) => ({ default: module.PingPongResult })),
)

export function GamePage({ roomId }: { roomId: string }) {
  const navigate = useNavigate()
  const roomSession = useAppStore((state) => state.roomSession)
  const roomSnapshot = useAppStore((state) => state.roomSnapshot)
  const roomResumeReason = useAppStore((state) => state.roomResumeReason)
  const [exitRequested, setExitRequested] = useState(false)
  const matchingRoom = roomSession?.roomId === roomId
  const pingPong = roomSnapshot?.gameCode === 'PING_PONG' || roomSession?.gameCode === 'PING_PONG'

  // 진행 상태(game)는 WebSocket state.sync로도 오지만, 새로고침·직접 진입에 대비해 한 번 받아둔다.
  useGame(matchingRoom && !pingPong ? roomSession.gameId : null)

  useEffect(() => {
    if (roomSnapshot?.phase === 'finished') playResultSoundtrack()
    else if (roomSnapshot?.phase === 'playing') playGameSoundtrack()
  }, [roomSnapshot?.phase])

  useEffect(() => {
    if (!roomSession || !roomSnapshot || !matchingRoom || roomResumeReason) {
      void navigate({ to: '/', replace: true })
      return
    }
    if (roomSnapshot.phase === 'waiting') {
      void navigate({
        to: '/rooms/$roomId/lobby',
        params: { roomId: roomSession.roomId },
        replace: true,
      })
    }
  }, [matchingRoom, navigate, roomResumeReason, roomSession, roomSnapshot])

  if (!roomSession || !roomSnapshot || !matchingRoom || roomResumeReason) return null

  return (
    <>
      <RoomExitGuard onClose={() => setExitRequested(false)} open={exitRequested} roomId={roomId} />
      {pingPong && roomSnapshot.phase === 'finished' ? (
        <Suspense fallback={null}>
          <PingPongResult
            onLeaveRequest={() => setExitRequested(true)}
            session={roomSession}
            snapshot={roomSnapshot}
          />
        </Suspense>
      ) : pingPong ? (
        <Suspense fallback={null}>
          <PingPongGame
            onLeaveRequest={() => setExitRequested(true)}
            roomId={roomId}
            session={roomSession}
            snapshot={roomSnapshot}
          />
        </Suspense>
      ) : roomSnapshot.phase === 'finished' ? (
        <GameResult
          onLeaveRequest={() => setExitRequested(true)}
          session={roomSession}
          snapshot={roomSnapshot}
        />
      ) : (
        <GamePlay
          onLeaveRequest={() => setExitRequested(true)}
          roomId={roomId}
          session={roomSession}
          snapshot={roomSnapshot}
        />
      )}
    </>
  )
}
