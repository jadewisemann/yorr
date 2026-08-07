import type { Game, GameKey } from '@/games'

/** 게임 탭이 제어하는 히어로 카피 영역. tab ↔ tabpanel을 잇는 고정 id다. */
export const LANDING_PANEL_ID = 'landing-game-panel'

export function landingTabId(key: GameKey) {
  return `landing-tab-${key}`
}

/** 탭 이름에 덧붙이는 한 줄 요약. 이름만으로는 어떤 게임인지 구분되지 않는다. */
export function gameMeta(game: Game) {
  return `${game.players} · ${game.duration}`
}
