export type GameKey = 'duel' | 'fishing' | 'liars' | 'pingpong' | 'yacht'
export type GameCode = 'DUEL' | 'PING_PONG' | 'YACHT_DICE'

export interface Game {
  control: string
  description: string
  duration: string
  gameCode?: GameCode
  key: GameKey
  live: boolean
  name: string
  players: string
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
