import type { PlayerId, RoomSnapshot } from '@/realtime/wsEvents'
import { Button } from '@/shared/components/Button'
import type { useAppStore } from '@/store'
import { LobbyPlayerCard } from './LobbyPlayerCard'

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
  onStart: () => void
  onRemoveBot: (playerId: PlayerId) => void
}

export function LobbyRoomContent({
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
  onStart,
  onRemoveBot,
}: LobbyRoomContentProps) {
  if (!snapshot) return null
  return (
    <>
      <section
        className="grid min-h-28 flex-1 auto-rows-min gap-2 overflow-y-auto"
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
          <p className="m-0 flex min-h-[4.25rem] items-center gap-3 rounded-panel border border-dashed border-border-raised px-3 text-sm text-content-muted tabular-nums">
            <span
              aria-hidden="true"
              className="size-11 flex-none rounded-card border border-dashed border-border-strong"
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
