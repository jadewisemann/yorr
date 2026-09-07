// 'fishing'은 카탈로그에서 내렸지만 히어로 아트 파이프라인(heroScene·bake-hero)이 아직
// 씬 키로 쓴다 — 다시 세우려면 games 배열에 항목만 되돌리면 된다.
export type GameKey = 'davinci' | 'duel' | 'fishing' | 'liars' | 'pingpong' | 'yacht'
export type GameCode = 'DAVINCI_CODE' | 'DUEL' | 'PING_PONG' | 'YACHT_DICE'

export interface Game {
  control: string
  description: string
  duration: string
  gameCode?: GameCode
  key: GameKey
  live: boolean
  /**
   * 방을 시작할 수 있는 최소 인원. 서버 `GAME_CATALOG`의 `minPlayers`와 같은 값이어야
   * 한다 — 서버는 이 수 미만이면 시작을 거절하므로, 여기가 다르면 대기실이 켜 준 시작
   * 버튼이 오류 문구로 끝난다.
   */
  minPlayers: number
  name: string
  players: string
  /**
   * 대기실에 봇 추가 패널을 둘지. 서버 `GAME_CATALOG`의 `supportsBots`와 같은 값이어야
   * 한다 — 서버는 미지원 게임의 봇 요청을 409 `bots_not_supported`로 거절하므로,
   * 여기가 `true`면 사람은 누를 때마다 오류 문구만 본다.
   */
  supportsBots: boolean
  tagline: string
}

export const games: [Game, ...Game[]] = [
  {
    key: 'yacht',
    name: '요트 다이스',
    tagline: '흔들어 굴리고, 전략적으로 킵하세요.',
    description: '12라운드 동안 가장 높은 점수를 완성하는 실시간 주사위 게임',
    players: '1–6 PLAYERS',
    duration: '약 15분',
    gameCode: 'YACHT_DICE',
    control: '휴대폰 흔들기',
    live: true,
    minPlayers: 1,
    supportsBots: true,
  },
  {
    key: 'pingpong',
    name: '탁구',
    tagline: '한 손가락으로 겨루는 초고속 랠리.',
    description: '먼저 11점을 얻는 쪽이 이기는 1:1 스피드 대결',
    players: '1–2 PLAYERS',
    duration: '약 3분',
    gameCode: 'PING_PONG',
    control: '화면 탭 · 폰 스윙',
    live: true,
    minPlayers: 2,
    supportsBots: false,
  },
  {
    key: 'duel',
    name: '석양이 진다',
    tagline: '신호가 뜨는 순간, 먼저 뽑으세요.',
    description: '먼저 3발 맞히는 쪽이 살아남는 반응 속도 대결',
    players: '2 PLAYERS',
    duration: '약 2분',
    gameCode: 'DUEL',
    control: '화면 탭 · 폰 휘두르기',
    live: true,
    minPlayers: 2,
    supportsBots: false,
  },
  {
    key: 'davinci',
    name: '다빈치 코드',
    tagline: '감춘 숫자를 읽고, 내 숫자는 지키세요.',
    description: '상대의 타일을 먼저 다 맞히는 쪽이 이기는 추리 게임',
    players: '2–4 PLAYERS',
    duration: '약 10분',
    gameCode: 'DAVINCI_CODE',
    control: '화면 탭',
    live: true,
    minPlayers: 2,
    supportsBots: false,
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
    minPlayers: 2,
    supportsBots: false,
  },
]

export function gameAt(index: number): Game {
  return games[index] ?? games[0]
}

export function gameIndexOf(key: GameKey | undefined): number {
  const index = games.findIndex((game) => game.key === key)
  return index === -1 ? 0 : index
}

export function isGameKey(value: unknown): value is GameKey {
  return typeof value === 'string' && games.some((game) => game.key === value)
}

export function isPartyGameKey(value: unknown): value is GameKey {
  return isGameKey(value) && gameByKey(value).gameCode !== undefined
}

export function gameByKey(key: GameKey | undefined): Game {
  return games.find((game) => game.key === key) ?? games[0]
}

export function gameByCode(code: GameCode | undefined): Game {
  return games.find((game) => game.gameCode === code) ?? games[0]
}
