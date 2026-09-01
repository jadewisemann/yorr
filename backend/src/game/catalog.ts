import { DomainError } from '../errors.js'

/**
 * 게임 메타데이터 — 방 정원·시작 인원·봇 지원 여부. **이 표가 세 값의 유일한 출처다.**
 *
 * **모듈은 이 값을 선언하지 않는다**(game/module.ts). 레지스트리가 이 카탈로그를
 * 흡수해 `require(code)`로 돌려준다 — 게임 슬라이스가 모듈에서 정원을 다시 적으면
 * 방 정원과 조용히 어긋나기 때문이다.
 *
 * 기본값(1 / 6 / true)은 야추가 그대로 쓰고 duel·pingpong이 덮어쓴다.
 */
export interface GameMetadata {
  readonly code: string
  readonly name: string
  readonly minPlayers: number
  readonly maxPlayers: number
  readonly supportsBots: boolean
}

export const YACHT_DICE = 'YACHT_DICE'
export const DUEL = 'DUEL'
export const PING_PONG = 'PING_PONG'
export const DAVINCI_CODE = 'DAVINCI_CODE'

export const GAME_CATALOG: readonly GameMetadata[] = [
  { code: YACHT_DICE, name: 'Yacht Dice', minPlayers: 1, maxPlayers: 6, supportsBots: true },
  { code: DUEL, name: 'Duel', minPlayers: 2, maxPlayers: 2, supportsBots: false },
  { code: PING_PONG, name: 'Ping Pong', minPlayers: 2, maxPlayers: 2, supportsBots: false },
  { code: DAVINCI_CODE, name: 'Da Vinci Code', minPlayers: 2, maxPlayers: 4, supportsBots: false },
]

/** 게임 코드 정규화 — 레지스트리도 같은 규칙을 써야 한다. */
export const normalizeGameCode = (code: string | null | undefined): string =>
  (code ?? '').trim().toUpperCase()

const normalize = normalizeGameCode

export class GameCatalog {
  private readonly byCode: Map<string, GameMetadata>

  constructor(games: readonly GameMetadata[] = GAME_CATALOG) {
    this.byCode = new Map()
    for (const game of games) {
      if (this.byCode.has(normalize(game.code))) throw new Error('duplicate_game_code')
      this.byCode.set(normalize(game.code), game)
    }
  }

  /** 못 찾으면 `invalid_game_code`(REST 400). 대소문자·공백은 관용한다. */
  require(code: string | null | undefined): GameMetadata {
    const game = this.byCode.get(normalize(code))
    if (!game) throw new DomainError('invalid_game_code')
    return game
  }

  /** 정규화된 표기로 되돌린다 — 방에 적히는 gameCode는 항상 이 형태다. */
  canonicalCode(code: string | null | undefined): string {
    return this.require(code).code
  }

  supportedCodes(): string[] {
    return [...this.byCode.keys()]
  }
}
