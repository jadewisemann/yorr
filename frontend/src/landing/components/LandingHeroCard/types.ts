import type { Game } from '@/games'

export interface LandingHeroCardProps {
  game: Game
  layout: 'narrow' | 'wide'
  onPlay: () => void
}
