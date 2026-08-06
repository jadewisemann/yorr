import { PeerMicButton } from '@/realtime/voice/PeerMicButton'
import type { VoiceChat } from '@/realtime/voice/useVoiceChat'
import type { Player, PlayerId } from '@/realtime/wsEvents'
import { PlayerCard } from '@/room/components/PlayerCard'
import { Button } from '@/shared/components/Button'

interface LobbyPlayerCardProps {
  player: Player
  you: PlayerId
  isHost: boolean
  loading: boolean
  /** 음성 채팅 상태. 이름 오른쪽 끝에 그 사람 마이크를 세운다(봇은 통화에 없어 안 뜬다). */
  voice: VoiceChat
  onRemove: (playerId: PlayerId) => void
}

export function LobbyPlayerCard({
  player,
  you,
  isHost,
  loading,
  voice,
  onRemove,
}: LobbyPlayerCardProps) {
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
