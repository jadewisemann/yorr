import type { Ref } from 'react'
import type { VoiceChat } from '@/realtime/voice/useVoiceChat'
import type { Player, PlayerId } from '@/realtime/wsEvents'
import type { ConnectionStatus } from '@/store'

export interface GamePlayHeaderProps {
  activePlayer: Player | undefined
  /** 오디오 말풍선이 붙을 자리. 소리 버튼에 꽂는다. */
  audioButtonRef?: Ref<HTMLButtonElement> | undefined
  activePlayerId: PlayerId | undefined
  connectionStatus: ConnectionStatus
  isMyTurn: boolean
  leaderLabel: string
  onHelp: () => void
  onLeave: () => void
  /** 소리 버튼이 오디오 시트를 연다(토글이 아니다 — 음소거는 시트 안에 있다). */
  onOpenAudio: () => void
  remainingMs: number
  roundNumber: number
  soundMuted: boolean
  submitted: boolean
  /** 음성 채팅 상태. 마이크 버튼은 소리 토글과 같은 자리에 선다. */
  voice: VoiceChat
  wide: boolean
}
