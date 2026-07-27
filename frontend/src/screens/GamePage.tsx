import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useAppStore } from '@/store'

export function GamePage({ roomId }: { roomId: string }) {
  const navigate = useNavigate()
  const roomSession = useAppStore((state) => state.roomSession)
  const roomSnapshot = useAppStore((state) => state.roomSnapshot)
  const matchingRoom = roomSession?.roomId === roomId

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

  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center text-content">
      <section className="grid gap-2">
        <p className="font-bold text-brand-strong">ROUND {roomSnapshot?.game?.roundNumber ?? 1}</p>
        <h1 className="text-display font-bold">
          {roomSnapshot.phase === 'finished' ? '게임이 끝났어요' : '게임이 시작됐어요'}
        </h1>
        <p className="text-content-muted">
          {roomSnapshot.phase === 'finished'
            ? '결과 화면을 준비하고 있어요.'
            : '주사위 게임 화면으로 이어집니다.'}
        </p>
      </section>
    </main>
  )
}
