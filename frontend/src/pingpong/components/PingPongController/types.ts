import type { PingPongState } from '@/realtime/wsEvents'

export interface ControllerView {
  countdown: number
  event: PingPongState['lastEvent']
  eventAge: number
  incoming: boolean
  label: string | null
  opponentId: string
  opponentName: string
  situationLabel: string | null
  swingActive: boolean
}

export type PaddleTone = 'blue' | 'red'

export interface PlayerSlot {
  id: string
  label: string
  tag: 'P1' | 'P2'
  tone: PaddleTone
}
