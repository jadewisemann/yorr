import type { ReactionType } from '@/realtime/wsEvents'

export const REACTIONS = [
  { emoji: '👍', label: '좋아요', type: 'like' },
  { emoji: '😂', label: '웃겨요', type: 'laugh' },
  { emoji: '😱', label: '놀랐어요', type: 'shock' },
  { emoji: '👏', label: '박수', type: 'clap' },
  { emoji: '🫡', label: 'GG', type: 'gg' },
] as const satisfies ReadonlyArray<{ emoji: string; label: string; type: ReactionType }>

export const FLIGHT_MS = 2_200
export const MAX_FLYING = 12
export const DRIFTS = ['-3.2rem', '-2.4rem', '-1.5rem', '-0.7rem', '0rem']

export const LIFTS = ['0rem', '-1.15rem', '-2.3rem']

export interface Flying {
  emoji: string
  id: number
  label: string
  nickname: string
}
