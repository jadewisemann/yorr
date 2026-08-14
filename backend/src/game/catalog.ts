import { DomainError } from '../errors.js'

/**
 * 게임 메타데이터 — 방 정원·시작 인원·봇 지원 여부.
 *
 * backend-java에서는 `GameModule` 구현체가 이 값을 들고 있고 `GameModuleRegistry`가
 * 코드로 찾아 준다. 방(Phase 1)은 게임 로직 없이 **이 세 값만** 필요하므로 먼저
 * 메타데이터만 옮긴다 — Phase 2.1에서 실제 모듈 레지스트리가 이 표를 흡수한다.
 *
 * `minPlayers`·`maxPlayers`·`supportsBots`는 Java `GameModule`의 기본값
 * (1 / 6 / true)을 야추가 그대로 쓰고, duel·pingpong이 덮어쓴 값이다.
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

export const GAME_CATALOG: readonly GameMetadata[] = [
  { code: YACHT_DICE, name: 'Yacht Dice', minPlayers: 1, maxPlayers: 6, supportsBots: true },
  { code: DUEL, name: 'Duel', minPlayers: 2, maxPlayers: 2, supportsBots: false },
  { code: PING_PONG, name: 'Ping Pong', minPlayers: 2, maxPlayers: 2, supportsBots: false },
]

const normalize = (code: string | null | undefined): string => (code ?? '').trim().toUpperCase()

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
