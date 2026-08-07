import type { Game, GameKey } from '@/games'

export const LANDING_PANEL_ID = 'landing-game-panel'

export function landingTabId(key: GameKey) {
  return `landing-tab-${key}`
}

export function gameMeta(game: Game) {
  return `${game.players} · ${game.duration}`
}
