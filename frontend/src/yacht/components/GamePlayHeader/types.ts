import type { Ref } from 'react'
import type { VoiceChat } from '@/realtime/voice/useVoiceChat'
import type { Player, PlayerId } from '@/realtime/wsEvents'
import type { ConnectionStatus } from '@/store'

export interface GamePlayHeaderProps {
  activePlayer: Player | undefined
  audioButtonRef?: Ref<HTMLButtonElement> | undefined
  activePlayerId: PlayerId | undefined
  connectionStatus: ConnectionStatus
  isMyTurn: boolean
  leaderLabel: string
  onHelp: () => void
  onLeave: () => void
  onOpenAudio: () => void
  remainingMs: number
  roundNumber: number
  soundMuted: boolean
  submitted: boolean
  voice: VoiceChat
  wide: boolean
}
