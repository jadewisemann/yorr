import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useStartGame } from '@/api/useGameApi'
import { cn } from '@/cn'
import { Button } from '@/components/Button'
import { InvitationPanel } from '@/components/InvitationPanel'
import { PlayerCard } from '@/components/PlayerCard'
import { useAppStore } from '@/store'
import { RoomExitGuard } from './RoomExitGuard'

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
  const roomResumeReason = useAppStore((state) => state.roomResumeReason)
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const startGame = useStartGame()
  const [exitRequested, setExitRequested] = useState(false)
  const matchingRoom = roomSession?.roomId === roomId
  const canStart =
    matchingRoom &&
    roomSession.membershipRole === 'host' &&
    connectionStatus === 'connected' &&
    roomSnapshot?.phase === 'waiting' &&
    roomSnapshot.players.length >= MIN_PLAYERS_TO_START

  useEffect(() => {
    if (!roomSession || !matchingRoom || roomResumeReason) {
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
  }, [matchingRoom, navigate, roomResumeReason, roomSession, roomSnapshot])

  const handleStart = async () => {
    if (!roomSession || !canStart) return
    await startGame.execute()
  }

  if (!roomSession || !matchingRoom || roomResumeReason) return null

  return (
    <>
      {/* 다이얼로그는 main 밖에 둔다 — Modal이 main에 inert를 걸어 안에 있으면
          모달 자신까지 클릭이 막힌다(GamePage·GameResult와 같은 배치). */}
      <RoomExitGuard onClose={() => setExitRequested(false)} open={exitRequested} roomId={roomId} />
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-5 px-gutter pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-content">
        {/* 디자인 03 헤더 — 좌측 타이틀·코드·연결 상태, 우측 나가기. */}
        <header className="flex items-center gap-3 border-b border-border pb-3.5">
          <div className="grid min-w-0 flex-1 gap-1">
            <h1 className="m-0 text-[19px] font-bold">대기실</h1>
            <p className="m-0 flex items-center gap-2 text-[13px] text-content-muted">
              <span className="font-mono font-bold tracking-[0.12em] text-content">
                {roomSession.roomCode}
              </span>
              <span aria-hidden="true" className="h-3 w-px bg-white/18" />
              <span className="inline-flex items-center gap-1.5" role="status">
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-1.5 rounded-full',
                    connectionStatus === 'connected' ? 'bg-positive' : 'bg-warning',
                  )}
                />
                {connectionLabel(connectionStatus)}
              </span>
            </p>
          </div>
          <Button
            className="min-h-10 flex-none px-3.5 text-sm"
            onClick={() => setExitRequested(true)}
            type="button"
            variant="danger"
          >
            나가기
          </Button>
        </header>

        <InvitationPanel roomCode={roomSession.roomCode} />

        {!roomSnapshot && (
          <p className="m-0 text-center text-sm text-content-muted" role="status">
            실시간 대기실에 연결하고 있어요.
          </p>
        )}

        {roomSnapshot && (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-[15px] font-semibold">참가 인원</span>
              <span className="font-mono text-base font-bold tabular-nums">
                {roomSnapshot.players.length}
                <span className="text-content-faint"> / 6</span>
              </span>
            </div>

            <section
              className="grid gap-2.5"
              aria-label={`참가자 ${roomSnapshot.players.length}명`}
            >
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
              {roomSnapshot.players.length < 6 && (
                <p className="m-0 flex min-h-[4.25rem] items-center gap-3 rounded-panel border border-dashed border-white/14 px-3 text-sm text-content-muted">
                  <span
                    aria-hidden="true"
                    className="size-11 flex-none rounded-card border border-dashed border-white/18"
                  />
                  빈 자리 {6 - roomSnapshot.players.length} · 링크를 공유해 초대하세요
                </p>
              )}
            </section>

            <div className="mt-auto grid gap-2 border-t border-border pt-3.5 text-center">
              <Button
                size="lg"
                className="min-h-[3.625rem] w-full rounded-panel text-lg"
                disabled={!canStart}
                loading={startGame.isLoading}
                onClick={handleStart}
              >
                {roomSession.membershipRole === 'participant'
                  ? '게임 시작 · 호스트 전용'
                  : '게임 시작'}
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
    </>
  )
}

function connectionLabel(status: ReturnType<typeof useAppStore.getState>['connectionStatus']) {
  if (status === 'connected') return '연결됨'
  if (status === 'reconnecting') return '재연결 중'
  if (status === 'closed') return '연결 종료'
  return '연결 중'
}
