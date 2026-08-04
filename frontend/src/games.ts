/**
 * 서비스가 아는 게임 카탈로그 — 어떤 게임이 있고 무엇이 플레이 가능한지의 SSOT다.
 * 랜딩 히어로·씬별 BGM·방의 게임 선택이 모두 이 목록을 본다. 특정 화면에 딸린
 * 데이터가 아니므로 도메인 폴더가 아니라 경계에 둔다.
 *
 * 게임을 추가할 때 손댈 곳: 이 목록에 항목 추가 → src/<게임>/ 구현 →
 * room/screens/GamePage에서 키로 화면 분기.
 */

/** 게임 식별자. 목록이 SSOT이므로 타입도 여기서 소유한다. */
export type GameKey = 'duel' | 'fishing' | 'liars' | 'pingpong' | 'yacht'
export type GameCode = 'PING_PONG' | 'YACHT_DICE'

export interface Game {
  /** 조작 방식 한 마디. 히어로 카드 메타 필의 세 번째 칸이다. */
  control: string
  /** 규칙을 한 문장으로 요약한 설명. 카드에서 가장 작게 읽히는 줄. */
  description: string
  duration: string
  /** 방 생성 시 백엔드 GameModuleRegistry에 전달할 코드. */
  gameCode?: GameCode
  key: GameKey
  /** 지금 플레이할 수 있는 게임인지. false면 랜딩에서 '준비 중'으로 노출된다. */
  live: boolean
  name: string
  /** 인원 배지. mono 대문자로 그리므로 라벨도 영문 표기를 쓴다. */
  players: string
  /** 카드에서 제목 다음으로 크게 읽히는 한 줄 카피. */
  tagline: string
}

/** 랜딩 히어로의 게임 목록. 순서가 곧 화면의 01–05 인덱스다. */
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
    players: '1–2 PLAYERS',
    duration: '약 3분',
    gameCode: 'PING_PONG',
    control: '화면 탭 · 폰 스윙',
    live: true,
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

export function isGameKey(value: unknown): value is GameKey {
  return typeof value === 'string' && games.some((game) => game.key === value)
}

export function gameByKey(key: GameKey | undefined): Game {
  return games.find((game) => game.key === key) ?? games[0]
}
