import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { PeerMicButton } from '@/realtime/voice/PeerMicButton'
import type { VoiceChat } from '@/realtime/voice/useVoiceChat'
import { VoiceButton } from '@/realtime/voice/VoiceButton'
import { useVoice } from '@/realtime/voice/VoiceContext'
import type { Player, PlayerId, RoomSnapshot } from '@/realtime/wsEvents'
import { isRoomHost } from '@/room/api/roomApi'
import { useAddBot, useRemoveBot, useStartGame } from '@/room/api/useGameApi'
import { InvitationPanel } from '@/room/components/InvitationPanel'
import { PlayerCard } from '@/room/components/PlayerCard'
import { playLandingSoundtrack } from '@/shared/audio/soundtrack'
import { cn } from '@/shared/cn'
import { Button } from '@/shared/components/Button'
import { LoadingOverlay } from '@/shared/components/LoadingOverlay'
import { useAppStore } from '@/store'
import { RoomExitGuard } from './RoomExitGuard'

const PREFETCH_FALLBACK_DELAY_MS = 500

function schedulePhysicsDicePrefetch() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const prefetch = () => {
    void import('@/yacht/rendering/physics-dice/loadWorld').then(({ prefetchPhysicsDiceWorld }) =>
      prefetchPhysicsDiceWorld(),
    )
  }
  const idleApi = window as unknown as {
    requestIdleCallback?: Window['requestIdleCallback']
    cancelIdleCallback?: Window['cancelIdleCallback']
  }
  if (idleApi.requestIdleCallback && idleApi.cancelIdleCallback) {
    const idleId = idleApi.requestIdleCallback(prefetch, { timeout: 2_000 })
    return () => idleApi.cancelIdleCallback?.(idleId)
  }
  const timeoutId = window.setTimeout(prefetch, PREFETCH_FALLBACK_DELAY_MS)
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
  // 통화 자체는 라우터 위 VoiceProvider가 들고 있다 — 여기서는 상태만 읽는다.
  const voice = useVoice()
  const [exitRequested, setExitRequested] = useState(false)
  const matchingRoom = roomSession?.roomId === roomId
  const isHost = matchingRoom && isRoomHost(roomSnapshot, roomSession.you)
  const capacity = roomSnapshot?.capacity ?? 6
  const pingPong =
    roomSnapshot?.gameCode === 'PING_PONG' ||
    (matchingRoom && roomSession?.gameCode === 'PING_PONG')
  const minPlayersToStart = pingPong ? 2 : 1
  const botMutationLoading = addBot.isLoading || removeBot.isLoading
  const botMutationError = addBot.error ?? removeBot.error
  const canStart =
    isHost &&
    connectionStatus === 'connected' &&
    roomSnapshot?.phase === 'waiting' &&
    roomSnapshot.players.length >= minPlayersToStart

  useEffect(() => {
    if (roomSnapshot?.phase === 'waiting') {
      playLandingSoundtrack(roomSnapshot.gameCode === 'PING_PONG' ? 'pingpong' : 'yacht')
    }
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
    if (!matchingRoom || roomSnapshot?.phase !== 'waiting' || pingPong) return
    return schedulePhysicsDicePrefetch()
  }, [matchingRoom, pingPong, roomSnapshot?.phase])

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
      {/* phase가 waiting을 벗어난 순간부터 게임 화면으로 옮겨질 때까지 덮는다. 호스트의
          "눌렀다"와 참가자의 "호스트가 시작했다"가 같은 신호라 조건이 하나로 끝난다 —
          참가자는 예전에 아무 예고 없이 화면이 바뀌었다. */}
      <LoadingOverlay
        message="게임을 준비하고 있어요"
        open={Boolean(roomSnapshot) && roomSnapshot?.phase !== 'waiting'}
      />
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
          {/* 게임 시작 전에 마이크 권한을 끝내두게 여기에 둔다 — 시작 직후에 권한 창이 뜨면
              첫 턴을 놓친다. 켠 통화는 게임 화면으로 그대로 이어진다(VoiceProvider가 라우터 위). */}
          <VoiceButton className="flex-none" voice={voice} />
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
          visible={Boolean(roomSnapshot && isHost && !pingPong)}
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
          minPlayers={minPlayersToStart}
          onRemoveBot={(playerId) => void removeBot.execute(playerId)}
          onStart={() => void handleStart()}
          snapshot={roomSnapshot}
          voice={voice}
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
  minPlayers: number
  connectionStatus: ReturnType<typeof useAppStore.getState>['connectionStatus']
  canStart: boolean
  startLoading: boolean
  startError: Error | null
  botLoading: boolean
  /** 음성 채팅 상태. 참가자 카드 이름 오른쪽 끝에 그 사람 마이크가 선다. */
  voice: VoiceChat
  onStart: () => void
  onRemoveBot: (playerId: PlayerId) => void
}

function LobbyRoomContent({
  snapshot,
  capacity,
  you,
  isHost,
  minPlayers,
  connectionStatus,
  canStart,
  startLoading,
  startError,
  botLoading,
  voice,
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
            voice={voice}
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
          size="cta"
          aria-describedby={canStart ? undefined : 'start-blocked'}
          className="w-full"
          disabled={!canStart}
          loading={startLoading}
          onClick={onStart}
        >
          {isHost ? '게임 시작' : '게임 시작 · 호스트 전용'}
        </Button>
        {!canStart && (
          <p className="m-0 text-sm text-content-muted" id="start-blocked">
            {!isHost
              ? '호스트가 게임을 시작하면 자동으로 이동해요.'
              : connectionStatus === 'connected'
                ? `${minPlayers}명부터 시작할 수 있어요.`
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
  /** 음성 채팅 상태. 이름 오른쪽 끝에 그 사람 마이크를 세운다(봇은 통화에 없어 안 뜬다). */
  voice: VoiceChat
  onRemove: (playerId: PlayerId) => void
}

function LobbyPlayerCard({ player, you, isHost, loading, voice, onRemove }: LobbyPlayerCardProps) {
  const isBot = player.kind === 'BOT'
  return (
    <PlayerCard
      name={player.nickname}
      avatarSeed={player.playerId}
      status={player.status}
      current={player.playerId === you}
      active={player.playerId === you}
      speaking={voice.speaking.has(player.playerId)}
      nameEnd={<PeerMicButton playerId={player.playerId} voice={voice} />}
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
