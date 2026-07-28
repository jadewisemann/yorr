import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useGame } from '@/api/useGameApi'
import { useAppStore } from '@/store'
import { GamePlay } from './GamePlay'
import { GameResult } from './GameResult'

export function GamePage({ roomId }: { roomId: string }) {
  const navigate = useNavigate()
  const roomSession = useAppStore((state) => state.roomSession)
  const roomSnapshot = useAppStore((state) => state.roomSnapshot)
  const matchingRoom = roomSession?.roomId === roomId

  // 진행 상태(game)는 WebSocket state.sync로도 오지만, 새로고침·직접 진입에 대비해 한 번 받아둔다.
  useGame(matchingRoom ? roomId : null)

  useEffect(() => {
    if (!roomSession || !roomSnapshot || !matchingRoom) {
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
  }, [matchingRoom, navigate, roomSession, roomSnapshot])

  if (!roomSession || !roomSnapshot || !matchingRoom) return null
  if (roomSnapshot.phase === 'finished') {
    return <GameResult session={roomSession} snapshot={roomSnapshot} />
  }

  return <GamePlay roomId={roomId} session={roomSession} snapshot={roomSnapshot} />
}
