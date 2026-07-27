import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useStartGame } from '@/api/useGameApi'
import { Button } from '@/components/Button'
import { InvitationPanel } from '@/components/InvitationPanel'
import { PlayerCard } from '@/components/PlayerCard'
import { useAppStore } from '@/store'

interface LobbyPageProps {
  roomId: string
}

export function LobbyPage({ roomId }: LobbyPageProps) {
  const navigate = useNavigate()
  const roomSession = useAppStore((state) => state.roomSession)
  const roomSnapshot = useAppStore((state) => state.roomSnapshot)
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const startGame = useStartGame()
  const matchingRoom = roomSession?.roomId === roomId
  const canStart =
    matchingRoom &&
    connectionStatus === 'connected' &&
    roomSnapshot?.phase === 'waiting' &&
    roomSnapshot.players.length >= 2

  useEffect(() => {
    if (!roomSession || !roomSnapshot || !matchingRoom) {
      void navigate({ to: '/', replace: true })
      return
    }
    if (roomSnapshot.phase !== 'waiting') {
      void navigate({
        to: '/rooms/$roomId/game',
        params: { roomId: roomSession.roomId },
        replace: true,
      })
    }
  }, [matchingRoom, navigate, roomSession, roomSnapshot])

  const handleStart = async () => {
    if (!roomSession || !canStart) return
    await startGame.execute(roomSession.roomId)
  }

  if (!roomSession || !roomSnapshot || !matchingRoom) return null

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-2xl content-center gap-6 p-6 text-content">
      <header className="grid gap-2 text-center">
        <p className="m-0 font-bold tracking-widest text-brand-strong">방 {roomSession.roomCode}</p>
        <h1 className="m-0 text-display font-bold">대기실</h1>
        <p className="m-0 text-content-muted">함께할 플레이어를 기다리고 있어요.</p>
      </header>

      <InvitationPanel roomCode={roomSession.roomCode} />

      <div className="flex items-center justify-between text-sm text-content-muted">
        <span>현재 인원 {roomSnapshot.players.length} / 최대 6명</span>
        <span role="status">{connectionLabel(connectionStatus)}</span>
      </div>

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
        {!canStart && (
          <p className="m-0 text-sm text-content-muted">
            {connectionStatus === 'connected'
              ? '2명부터 시작할 수 있어요.'
              : '연결된 뒤 게임을 시작할 수 있어요.'}
          </p>
        )}
        {startGame.error && (
          <p className="m-0 text-sm text-danger" role="alert">
            게임을 시작하지 못했어요: {startGame.error.message}
          </p>
        )}
      </div>
    </main>
  )
}

function connectionLabel(status: ReturnType<typeof useAppStore.getState>['connectionStatus']) {
  if (status === 'connected') return '연결됨'
  if (status === 'reconnecting') return '재연결 중'
  if (status === 'closed') return '연결 종료'
  return '연결 중'
}
