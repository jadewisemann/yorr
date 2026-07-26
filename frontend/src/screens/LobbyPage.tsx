import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useStartGame } from '@/api/useGameApi'
import { Button } from '@/components/Button'
import { PlayerCard } from '@/components/PlayerCard'
import { useAppStore } from '@/store'

export function LobbyPage() {
  const navigate = useNavigate()
  const roomSession = useAppStore((state) => state.roomSession)
  const roomSnapshot = useAppStore((state) => state.roomSnapshot)
  const startGame = useStartGame()
  const canStart = roomSnapshot?.phase === 'waiting' && roomSnapshot.players.length >= 2

  useEffect(() => {
    if (!roomSession || !roomSnapshot) void navigate({ to: '/' })
  }, [navigate, roomSession, roomSnapshot])

  const handleStart = async () => {
    if (!roomSession || !canStart) return
    const snapshot = await startGame.execute(roomSession.roomId)
    if (snapshot?.phase !== 'playing') return

    await navigate({
      to: '/rooms/$roomId/game',
      params: { roomId: roomSession.roomId },
    })
  }

  if (!roomSession || !roomSnapshot) return null

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-2xl content-center gap-6 p-6 text-content">
      <header className="grid gap-2 text-center">
        <p className="m-0 font-bold tracking-widest text-brand-strong">방 {roomSession.roomCode}</p>
        <h1 className="m-0 text-display font-bold">대기실</h1>
        <p className="m-0 text-content-muted">함께할 플레이어를 기다리고 있어요.</p>
      </header>

      <section className="grid gap-3" aria-label={`참가자 ${roomSnapshot.players.length}명`}>
        {roomSnapshot.players.map((player) => (
          <PlayerCard
            key={player.playerId}
            name={player.nickname}
            avatarSeed={player.playerId}
            status={player.status}
            current={player.playerId === roomSession.you}
            active={player.playerId === roomSession.you}
          />
        ))}
      </section>

      <div className="grid gap-2 text-center">
        <Button
          size="lg"
          className="w-full"
          disabled={!canStart}
          loading={startGame.isLoading}
          onClick={handleStart}
        >
          게임 시작
        </Button>
        {!canStart && <p className="m-0 text-sm text-content-muted">2명부터 시작할 수 있어요.</p>}
        {startGame.error && (
          <p className="m-0 text-sm text-danger" role="alert">
            게임을 시작하지 못했어요: {startGame.error.message}
          </p>
        )}
      </div>
    </main>
  )
}
