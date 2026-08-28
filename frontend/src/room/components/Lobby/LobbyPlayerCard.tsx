import type { Player, PlayerId } from '@/realtime/wsEvents'
import { PlayerCard } from '@/room/components/PlayerCard'
import { Button } from '@/shared/components/Button'

interface LobbyPlayerCardProps {
  player: Player
  you: PlayerId
  isHost: boolean
  loading: boolean
  onRemove: (playerId: PlayerId) => void
}

export function LobbyPlayerCard({ player, you, isHost, loading, onRemove }: LobbyPlayerCardProps) {
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
