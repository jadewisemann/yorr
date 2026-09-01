import type { PlayerId, RoomSnapshot } from '@/realtime/wsEvents'
import { Button } from '@/shared/components/Button'
import type { useAppStore } from '@/store'
import { LobbyPlayerCard } from './LobbyPlayerCard'

interface LobbyPlayerListProps {
  snapshot: RoomSnapshot | null
  capacity: number
  you: PlayerId
  isHost: boolean
  botLoading: boolean
  onRemoveBot: (playerId: PlayerId) => void
}

interface LobbyStartPanelProps {
  snapshot: RoomSnapshot | null
  isHost: boolean
  minPlayers: number
  connectionStatus: ReturnType<typeof useAppStore.getState>['connectionStatus']
  canStart: boolean
  startLoading: boolean
  startError: Error | null
  onStart: () => void
}

/**
 * 참가자 목록. **자체 스크롤을 갖지 않는다** — 대기실 본문 전체가 하나의 스크롤 영역이고
 * (LobbyPage), 그 안에서 또 스크롤하면 목록만 따로 굴려야 해서 채팅이 상주하는 좁은 화면에서
 * 어느 쪽을 굴리는지 알기 어렵다.
 */
export function LobbyPlayerList({
  botLoading,
  capacity,
  isHost,
  onRemoveBot,
  snapshot,
  you,
}: LobbyPlayerListProps) {
  if (!snapshot) return null

  return (
    <section
      className="grid flex-none auto-rows-min grid-cols-1 gap-2"
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
  )
}

/**
 * 게임 시작 버튼과 못 시작하는 이유. 목록과 떨어져 있는 이유: 이것은 스크롤 영역 밖에
 * **늘 보이는 자리**를 지켜야 한다 — 호스트가 시작하려고 목록을 굴려 내려야 하면 안 된다.
 */
export function LobbyStartPanel({
  canStart,
  connectionStatus,
  isHost,
  minPlayers,
  onStart,
  snapshot,
  startError,
  startLoading,
}: LobbyStartPanelProps) {
  if (!snapshot) return null

  return (
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
  )
}
