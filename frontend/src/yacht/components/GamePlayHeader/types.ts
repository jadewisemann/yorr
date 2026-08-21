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
  /** null이면 제한 시간이 없는 판 — 타이머를 그리지 않는다. */
  remainingMs: number | null
  roundNumber: number
  soundMuted: boolean
  submitted: boolean
  voice: VoiceChat
  wide: boolean
}
