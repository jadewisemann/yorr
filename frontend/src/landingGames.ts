/**
 * 히어로 씬이 그릴 게임 키. 게임 목록이 SSOT이므로 타입도 여기서 소유한다 —
 * 반대로 두면 데이터 모듈이 three.js 렌더러에 의존하게 된다.
 */
export type HeroGameKey = 'duel' | 'fishing' | 'liars' | 'pingpong' | 'yacht'

export interface LandingGame {
  duration: string
  key: HeroGameKey
  /** 지금 플레이할 수 있는 게임인지. false면 랜딩에서 '준비 중'으로 노출된다. */
  live: boolean
  name: string
  players: string
}

/** 랜딩 히어로의 게임 목록. 순서가 곧 화면의 01–05 인덱스다. */
export const landingGames: [LandingGame, ...LandingGame[]] = [
  { key: 'yacht', name: '요트 다이스', players: '1–6인', duration: '한 판 4–5분', live: true },
  { key: 'liars', name: '라이어스 다이스', players: '2–6인', duration: '한 판 6분', live: false },
  { key: 'duel', name: '정오의 결투', players: '2–4인', duration: '한 판 1분', live: false },
  { key: 'pingpong', name: '탁구', players: '2인', duration: '한 판 3분', live: false },
  { key: 'fishing', name: '낚시', players: '2–8인', duration: '한 판 5분', live: false },
]

/** 게임 탭이 제어하는 히어로 카피 영역. tab ↔ tabpanel을 잇는 고정 id다. */
export const LANDING_PANEL_ID = 'landing-game-panel'

export function landingTabId(key: HeroGameKey) {
  return `landing-tab-${key}`
}

export function landingGameAt(index: number): LandingGame {
  return landingGames[index] ?? landingGames[0]
}

export function gameMeta(game: LandingGame) {
  return `${game.players} · ${game.duration}`
}
