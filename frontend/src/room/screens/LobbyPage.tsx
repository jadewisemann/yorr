import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { Player, PlayerId, RoomSnapshot } from '@/realtime/wsEvents'
import { useAddBot, useRemoveBot, useStartGame } from '@/room/api/useGameApi'
import { InvitationPanel } from '@/room/components/InvitationPanel'
import { PlayerCard } from '@/room/components/PlayerCard'
import { playLandingSoundtrack } from '@/shared/audio/soundtrack'
import { cn } from '@/shared/cn'
import { Button } from '@/shared/components/Button'
import { useAppStore } from '@/store'
import { prefetchPhysicsDiceWorld } from '@/yacht/rendering/physics-dice/loadWorld'
import { RoomExitGuard } from './RoomExitGuard'

/**
 * 시작 가능한 최소 인원. 서버도 1명부터 허용한다(RoomValidationService의 START 스크립트).
 * 조건식과 안내 문구 두 곳에 숫자를 적으면 한쪽만 고쳐져 어긋나므로 여기서만 정의한다.
 */
const MIN_PLAYERS_TO_START = 1
const PREFETCH_FALLBACK_DELAY_MS = 500

function schedulePhysicsDicePrefetch() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const idleApi = window as unknown as {
    requestIdleCallback?: Window['requestIdleCallback']
    cancelIdleCallback?: Window['cancelIdleCallback']
  }
  if (idleApi.requestIdleCallback && idleApi.cancelIdleCallback) {
    const idleId = idleApi.requestIdleCallback(prefetchPhysicsDiceWorld, { timeout: 2_000 })
    return () => idleApi.cancelIdleCallback?.(idleId)
  }
  const timeoutId = window.setTimeout(prefetchPhysicsDiceWorld, PREFETCH_FALLBACK_DELAY_MS)
  return () => window.clearTimeout(timeoutId)
}

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
  const addBot = useAddBot()
  const removeBot = useRemoveBot()
  const [exitRequested, setExitRequested] = useState(false)
  const matchingRoom = roomSession?.roomId === roomId
  const isHost = matchingRoom && roomSession.membershipRole === 'host'
  const capacity = roomSnapshot?.capacity ?? 6
  const botMutationLoading = addBot.isLoading || removeBot.isLoading
  const botMutationError = addBot.error ?? removeBot.error
  const canStart =
    isHost &&
    connectionStatus === 'connected' &&
    roomSnapshot?.phase === 'waiting' &&
    roomSnapshot.players.length >= MIN_PLAYERS_TO_START

  useEffect(() => {
    if (roomSnapshot?.phase === 'waiting') playLandingSoundtrack('yacht')
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

  useEffect(() => {
    if (!matchingRoom || roomSnapshot?.phase !== 'waiting') return
    return schedulePhysicsDicePrefetch()
  }, [matchingRoom, roomSnapshot?.phase])

  const handleStart = async () => {
    if (!roomSession || !canStart) return
    await startGame.execute()
  }

  const handleAddBot = async () => {
    if (!isHost || !roomSnapshot || roomSnapshot.players.length >= capacity) return
    await addBot.execute()
  }

  if (!roomSession || !matchingRoom || roomResumeReason) return null

  return (
    <>
      {/* 다이얼로그는 main 밖에 둔다 — Modal이 main에 inert를 걸어 안에 있으면
          모달 자신까지 클릭이 막힌다(GamePage·GameResult와 같은 배치). */}
      <RoomExitGuard onClose={() => setExitRequested(false)} open={exitRequested} roomId={roomId} />
      {/* 뷰포트 높이로 프레임을 고정하고 페이지 스크롤을 막는다 — 참가자가 많아져도
          스크롤은 아래 참가자 목록 안에서만 일어난다(QA FND-6, GamePlay와 같은 패턴). */}
      <main className="mx-auto flex h-svh w-full max-w-2xl flex-col gap-5 overflow-hidden px-gutter pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-content">
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
            className="flex-none px-3.5 text-sm"
            onClick={() => setExitRequested(true)}
            type="button"
            variant="danger"
          >
            나가기
          </Button>
        </header>

        <InvitationPanel roomCode={roomSession.roomCode} />

        <BotManagementPanel
          adding={addBot.isLoading}
          capacity={capacity}
          error={botMutationError}
          loading={botMutationLoading}
          onAdd={() => void handleAddBot()}
          playerCount={roomSnapshot?.players.length ?? 0}
          visible={Boolean(roomSnapshot && isHost)}
        />

        {!roomSnapshot && (
          <p className="m-0 text-center text-sm text-content-muted" role="status">
            실시간 대기실에 연결하고 있어요.
          </p>
        )}

        <LobbyRoomContent
          botLoading={botMutationLoading}
          canStart={canStart}
          capacity={capacity}
          connectionStatus={connectionStatus}
          isHost={isHost}
          membershipRole={roomSession.membershipRole}
          onRemoveBot={(playerId) => void removeBot.execute(playerId)}
          onStart={() => void handleStart()}
          snapshot={roomSnapshot}
          startError={startGame.error}
          startLoading={startGame.isLoading}
          you={roomSession.you}
        />
      </main>
    </>
  )
}

interface LobbyRoomContentProps {
  snapshot: RoomSnapshot | null
  capacity: number
  you: PlayerId
  isHost: boolean
  membershipRole: 'host' | 'participant'
  connectionStatus: ReturnType<typeof useAppStore.getState>['connectionStatus']
  canStart: boolean
  startLoading: boolean
  startError: Error | null
  botLoading: boolean
  onStart: () => void
  onRemoveBot: (playerId: PlayerId) => void
}

function LobbyRoomContent({
  snapshot,
  capacity,
  you,
  isHost,
  membershipRole,
  connectionStatus,
  canStart,
  startLoading,
  startError,
  botLoading,
  onStart,
  onRemoveBot,
}: LobbyRoomContentProps) {
  if (!snapshot) return null
  return (
    <>
      <div className="flex flex-none items-baseline justify-between">
        <span className="text-[15px] font-semibold">참가 인원</span>
        <span className="font-mono text-base font-bold tabular-nums">
          {snapshot.players.length}
          <span className="text-content-faint"> / {capacity}</span>
        </span>
      </div>

      <section
        className="grid min-h-0 flex-1 auto-rows-min gap-2.5 overflow-y-auto"
        aria-label={`참가자 ${snapshot.players.length}명`}
      >
        {snapshot.players.map((player) => (
          <LobbyPlayerCard
            isHost={isHost}
            key={player.playerId}
            loading={botLoading}
            onRemove={onRemoveBot}
            player={player}
            you={you}
          />
        ))}
        {snapshot.players.length < capacity && (
          <p className="m-0 flex min-h-[4.25rem] items-center gap-3 rounded-panel border border-dashed border-white/14 px-3 text-sm text-content-muted tabular-nums">
            <span
              aria-hidden="true"
              className="size-11 flex-none rounded-card border border-dashed border-white/18"
            />
            빈 자리 {capacity - snapshot.players.length} · 링크를 공유해 초대하세요
          </p>
        )}
      </section>

      <div className="grid flex-none gap-2 border-t border-border pt-3.5 text-center">
        <Button
          size="lg"
          aria-describedby={canStart ? undefined : 'start-blocked'}
          className="min-h-[3.625rem] w-full rounded-panel text-lg"
          disabled={!canStart}
          loading={startLoading}
          onClick={onStart}
        >
          {membershipRole === 'participant' ? '게임 시작 · 호스트 전용' : '게임 시작'}
        </Button>
        {!canStart && (
          <p className="m-0 text-sm text-content-muted" id="start-blocked">
            {membershipRole === 'participant'
              ? '호스트가 게임을 시작하면 자동으로 이동해요.'
              : connectionStatus === 'connected'
                ? `${MIN_PLAYERS_TO_START}명부터 시작할 수 있어요.`
                : '연결된 뒤 게임을 시작할 수 있어요.'}
          </p>
        )}
        {startError && (
          <p className="m-0 text-sm text-danger" role="alert">
            게임을 시작하지 못했어요: {startError.message}
          </p>
        )}
      </div>
    </>
  )
}

interface BotManagementPanelProps {
  visible: boolean
  playerCount: number
  capacity: number
  loading: boolean
  adding: boolean
  error: Error | null
  onAdd: () => void
}

function BotManagementPanel({
  visible,
  playerCount,
  capacity,
  loading,
  adding,
  error,
  onAdd,
}: BotManagementPanelProps) {
  if (!visible) return null
  return (
    <section
      aria-label="AI 봇 관리"
      className="grid flex-none gap-2 rounded-panel border border-border bg-surface-raised p-3"
    >
      <p className="m-0 text-xs text-content-muted">
        점수판과 남은 기회를 계산하는 AI 봇을 추가합니다.
      </p>
      <Button
        disabled={loading || playerCount >= capacity}
        loading={adding}
        onClick={onAdd}
        type="button"
        variant="secondary"
      >
        봇 추가
      </Button>
      {error && (
        <p className="m-0 text-xs text-danger" role="alert">
          봇을 변경하지 못했어요: {error.message}
        </p>
      )}
    </section>
  )
}

interface LobbyPlayerCardProps {
  player: Player
  you: PlayerId
  isHost: boolean
  loading: boolean
  onRemove: (playerId: PlayerId) => void
}

function LobbyPlayerCard({ player, you, isHost, loading, onRemove }: LobbyPlayerCardProps) {
  const isBot = player.kind === 'BOT'
  return (
    <PlayerCard
      name={player.nickname}
      avatarSeed={player.playerId}
      status={player.status}
      current={player.playerId === you}
      active={player.playerId === you}
      subtitle={isBot ? '상태 기반 AI 봇' : undefined}
      trailing={
        isBot && isHost ? (
          <Button
            className="min-h-9 px-2.5 text-xs"
            disabled={loading}
            onClick={() => onRemove(player.playerId)}
            type="button"
            variant="danger"
          >
            삭제
          </Button>
        ) : undefined
      }
    />
  )
}

function connectionLabel(status: ReturnType<typeof useAppStore.getState>['connectionStatus']) {
  if (status === 'connected') return '연결됨'
  if (status === 'reconnecting') return '재연결 중'
  if (status === 'closed') return '연결 종료'
  return '연결 중'
}
