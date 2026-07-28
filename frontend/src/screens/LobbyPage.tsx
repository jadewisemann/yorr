import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useStartGame } from '@/api/useGameApi'
import { Button } from '@/components/Button'
import { InvitationPanel } from '@/components/InvitationPanel'
import { PlayerCard } from '@/components/PlayerCard'
import { useAppStore } from '@/store'

/**
 * 시작 가능한 최소 인원. 서버도 1명부터 허용한다(RoomValidationService의 START 스크립트).
 * 조건식과 안내 문구 두 곳에 숫자를 적으면 한쪽만 고쳐져 어긋나므로 여기서만 정의한다.
 */
const MIN_PLAYERS_TO_START = 1

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
    roomSession.membershipRole === 'host' &&
    connectionStatus === 'connected' &&
    roomSnapshot?.phase === 'waiting' &&
    roomSnapshot.players.length >= MIN_PLAYERS_TO_START

  useEffect(() => {
    if (!roomSession || !matchingRoom) {
      void navigate({ to: '/', replace: true })
      return
    }
    if (roomSnapshot && roomSnapshot.phase !== 'waiting') {
      void navigate({
        to: '/rooms/$roomId/game',
        params: { roomId: roomSession.roomId },
        replace: true,
      })
    }
  }, [matchingRoom, navigate, roomSession, roomSnapshot])

  const handleStart = async () => {
    if (!roomSession || !canStart) return
    await startGame.execute()
  }

  if (!roomSession || !matchingRoom) return null

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-2xl content-center gap-6 p-6 text-content">
      <header className="grid gap-2 text-center">
        <p className="m-0 font-bold tracking-widest text-brand-strong">방 {roomSession.roomCode}</p>
        <h1 className="m-0 text-display font-bold">대기실</h1>
        <p className="m-0 text-content-muted">함께할 플레이어를 기다리고 있어요.</p>
      </header>

      <InvitationPanel roomCode={roomSession.roomCode} />

      {!roomSnapshot && (
        <p className="m-0 text-center text-sm text-content-muted" role="status">
          실시간 대기실에 연결하고 있어요.
        </p>
      )}

      {roomSnapshot && (
        <>
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
                {roomSession.membershipRole === 'participant'
                  ? '호스트가 게임을 시작하면 자동으로 이동해요.'
                  : connectionStatus === 'connected'
                    ? `${MIN_PLAYERS_TO_START}명부터 시작할 수 있어요.`
                    : '연결된 뒤 게임을 시작할 수 있어요.'}
              </p>
            )}
            {startGame.error && (
              <p className="m-0 text-sm text-danger" role="alert">
                게임을 시작하지 못했어요: {startGame.error.message}
              </p>
            )}
          </div>
        </>
      )}
    </main>
  )
}

function connectionLabel(status: ReturnType<typeof useAppStore.getState>['connectionStatus']) {
  if (status === 'connected') return '연결됨'
  if (status === 'reconnecting') return '재연결 중'
  if (status === 'closed') return '연결 종료'
  return '연결 중'
}
