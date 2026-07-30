/**
 * 히어로 씬이 그릴 게임 키. 게임 목록이 SSOT이므로 타입도 여기서 소유한다 —
 * 반대로 두면 데이터 모듈이 three.js 렌더러에 의존하게 된다.
 */
export type HeroGameKey = 'duel' | 'fishing' | 'liars' | 'pingpong' | 'yacht'

export interface LandingGame {
  /** 조작 방식 한 마디. 히어로 카드 메타 필의 세 번째 칸이다. */
  control: string
  /** 규칙을 한 문장으로 요약한 설명. 카드에서 가장 작게 읽히는 줄. */
  description: string
  duration: string
  key: HeroGameKey
  /** 지금 플레이할 수 있는 게임인지. false면 랜딩에서 '준비 중'으로 노출된다. */
  live: boolean
  name: string
  /** 인원 배지. mono 대문자로 그리므로 라벨도 영문 표기를 쓴다. */
  players: string
  /** 카드에서 제목 다음으로 크게 읽히는 한 줄 카피. */
  tagline: string
}

/** 랜딩 히어로의 게임 목록. 순서가 곧 화면의 01–05 인덱스다. */
export const landingGames: [LandingGame, ...LandingGame[]] = [
  {
    key: 'yacht',
    name: '요트 다이스',
    tagline: '흔들어 굴리고, 전략적으로 킵하세요.',
    description: '12라운드 동안 가장 높은 점수를 완성하는 실시간 주사위 게임',
    players: '1–6 PLAYERS',
    duration: '약 5분',
    control: '휴대폰 흔들기',
    live: true,
  },
  {
    key: 'liars',
    name: '라이어스 다이스',
    tagline: '가진 주사위를 숨기고 허풍을 겨루세요.',
    description: '상대의 선언을 믿거나 의심해 마지막 주사위를 지키는 심리 게임',
    players: '2–6 PLAYERS',
    duration: '약 6분',
    control: '화면 탭',
    live: false,
  },
  {
    key: 'duel',
    name: '정오의 결투',
    tagline: '신호가 뜨는 순간, 먼저 뽑으세요.',
    description: '0.01초로 승부가 갈리는 반응 속도 대결',
    players: '2–4 PLAYERS',
    duration: '약 1분',
    control: '화면 탭',
    live: false,
  },
  {
    key: 'pingpong',
    name: '탁구',
    tagline: '한 손가락으로 겨루는 초고속 랠리.',
    description: '먼저 11점을 얻는 쪽이 이기는 1:1 스피드 대결',
    players: '2 PLAYERS',
    duration: '약 3분',
    control: '화면 드래그',
    live: false,
  },
  {
    key: 'fishing',
    name: '낚시',
    tagline: '입질이 오는 순간을 놓치지 마세요.',
    description: '가장 무거운 물고기를 건져 올리는 타이밍 게임',
    players: '2–8 PLAYERS',
    duration: '약 5분',
    control: '휴대폰 흔들기',
    live: false,
  },
]

/** 게임 탭이 제어하는 히어로 카피 영역. tab ↔ tabpanel을 잇는 고정 id다. */
export const LANDING_PANEL_ID = 'landing-game-panel'

/** 모든 게임에 똑같이 붙는 메타 — 게임별 값이 아니라서 목록 데이터에 넣지 않는다. */
export const LANDING_SHARED_META = '실시간 멀티플레이'

export function landingTabId(key: HeroGameKey) {
  return `landing-tab-${key}`
}

export function landingGameAt(index: number): LandingGame {
  return landingGames[index] ?? landingGames[0]
}

/** 탭 이름에 덧붙이는 한 줄 요약. 이름만으로는 어떤 게임인지 구분되지 않는다. */
export function gameMeta(game: LandingGame) {
  return `${game.players} · ${game.duration}`
}
