import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useGame } from '@/api/useGameApi'
import { playGameSoundtrack, playResultSoundtrack } from '@/shared/landingSoundtrack'
import { useAppStore } from '@/store'
import { GamePlay } from './GamePlay'
import { GameResult } from './GameResult'
import { RoomExitGuard } from './RoomExitGuard'

export function GamePage({ roomId }: { roomId: string }) {
  const navigate = useNavigate()
  const roomSession = useAppStore((state) => state.roomSession)
  const roomSnapshot = useAppStore((state) => state.roomSnapshot)
  const roomResumeReason = useAppStore((state) => state.roomResumeReason)
  const [exitRequested, setExitRequested] = useState(false)
  const matchingRoom = roomSession?.roomId === roomId

  // 진행 상태(game)는 WebSocket state.sync로도 오지만, 새로고침·직접 진입에 대비해 한 번 받아둔다.
  useGame(matchingRoom ? roomSession.gameId : null)

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
      {roomSnapshot.phase === 'finished' ? (
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
