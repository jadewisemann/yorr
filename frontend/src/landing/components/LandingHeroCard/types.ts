import type { Game } from '@/games'

export interface LandingHeroCardProps {
  game: Game
  /** wide = 데스크톱 네 모서리 카드, narrow = 모바일 상하 2단 카드. */
  layout: 'narrow' | 'wide'
  /** 카드 안 플레이 CTA. 준비 중인 게임은 잠긴 버튼이 같은 자리에 서므로 호출되지 않는다. */
  onPlay: () => void
}
