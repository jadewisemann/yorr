// Stryker disable StringLiteral: 여기서 던지는 메시지는 사람이 읽는 설명이지 계약이
// 아니다 — 상위 계층이 이유 코드로 옮겨 담는다. 문구를 검사에 박으면 문구를 다듬을
// 때마다 검사가 깨진다.

/**
 * 최종 순위 산출 — 순수 함수 묶음이다.
 *
 * 저장소도 전송 계층도 모른다. 입력은 "playerId → 최종 점수"뿐이고, 그 점수는
 * **서버가 확정해 Redis에 쌓아둔 값**이다(DESIGN.md 원칙 1).
 */

/**
 * 순위 도메인의 **인자 검증 실패**.
 * `errors.ts`의 `DomainError`를 상속하지 않는다(점수 도메인과 같은 이유):
 * 저쪽은 REST의 소문자 코드 계약이고 이쪽은 도메인 내부 검증이다.
 */
export class GameCompletionDomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GameCompletionDomainError'
  }
}

/** 순위 한 줄 — `game.over` payload와 `/results` 응답이 그대로 싣는 모양이다. */
export interface Ranking {
  /** 1부터. 동점은 같은 rank를 공유한다. */
  readonly rank: number
  readonly playerId: string
  readonly total: number
}

export interface PlayerFinalScore {
  readonly playerId: string
  readonly finalScore: number
}

export interface PlayerResult {
  readonly playerId: string
  readonly finalScore: number
  readonly rank: number
  readonly winner: boolean
  /** 같은 점수를 가진 사람이 또 있는가(1위 동점이 아니어도 true). */
  readonly tied: boolean
}

export interface GameResult {
  readonly players: readonly PlayerResult[]
  /** **1위가 동점일 때만** true. 중간 순위 동점은 여기에 영향을 주지 않는다. */
  readonly isTie: boolean
}

/**
 * 총점 내림차순 · playerId 오름차순. 정렬 기준이 두 곳(서비스 랭킹·결과 계산기)에서
 * 같아야 해서 한 함수로 둔다 — 두 벌로 두면 조용히 갈라진다.
 */
const byTotalDescThenPlayerId = (
  left: readonly [string, number],
  right: readonly [string, number],
): number => {
  if (left[1] !== right[1]) return right[1] - left[1]
  // 여기서 부등호를 흔드는 돌연변이는 **같은 playerId가 두 번 올 때만** 결과가 달라진다.
  // 그런 입력에서는 두 항목이 완전히 같아 정렬 결과도 같으므로 죽일 방법이 없다(등가).
  // Stryker disable next-line all
  return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0
}

/**
 * 경쟁 순위(competition ranking): 동점은 같은 순위를 공유하고 **다음 순위는 인원수만큼
 * 건너뛴다** — 1,2,2,4(1,2,2,3이 아니다).
 *
 * 검증하지 않는다. 빈 입력이면 빈 목록이다(끝난 방에 아무도 없을 수 있고, 그때
 * 예외를 던지면 종료 방송 자체가 막힌다).
 */
export const rankTotals = (totals: Iterable<readonly [string, number]>): Ranking[] => {
  const ordered = [...totals].sort(byTotalDescThenPlayerId)

  const rankings: Ranking[] = []
  let rank = 0
  let previousTotal: number | null = null
  ordered.forEach(([playerId, total], index) => {
    // `previousTotal`이 null이면 어떤 수와도 다르므로 `!==` 하나로 첫 항목까지 걸린다.
    if (previousTotal !== total) {
      rank = index + 1
      previousTotal = total
    }
    rankings.push({ rank, playerId, total })
  })
  return rankings
}

/**
 * 순위 + 승자·동점 표시까지 붙인 결과. 조회 REST(`/results`)가 쓴다.
 *
 * 빈 목록·중복 playerId·빈 playerId·음수 점수는 거부한다.
 */
export const calculateGameResult = (playerScores: readonly PlayerFinalScore[]): GameResult => {
  validate(playerScores)

  const counts = new Map<number, number>()
  for (const { finalScore } of playerScores) {
    counts.set(finalScore, (counts.get(finalScore) ?? 0) + 1)
  }

  const players = rankTotals(
    playerScores.map(({ playerId, finalScore }) => [playerId, finalScore]),
  ).map<PlayerResult>(({ rank, playerId, total }) => ({
    playerId,
    finalScore: total,
    rank,
    winner: rank === 1,
    tied: (counts.get(total) ?? 0) > 1,
  }))

  // `validate`가 빈 목록을 이미 거부하므로 `players[0]`은 반드시 있다. 옵셔널 체이닝은
  // 그 사실이 바뀔 때를 위한 보험이다.
  // Stryker disable next-line OptionalChaining
  const topScore = players[0]?.finalScore ?? 0
  return Object.freeze({
    players: Object.freeze(players),
    isTie: (counts.get(topScore) ?? 0) > 1,
  })
}

const validate = (playerScores: readonly PlayerFinalScore[]): void => {
  // 타입이 막는 입력에 대한 런타임 방어다.
  // Stryker disable all
  if (playerScores === null || playerScores === undefined) {
    throw new GameCompletionDomainError('플레이어 최종 점수 목록은 null일 수 없습니다.')
  }
  // Stryker restore all
  // Stryker disable StringLiteral
  if (playerScores.length === 0) {
    throw new GameCompletionDomainError('플레이어 최종 점수 목록은 비어 있을 수 없습니다.')
  }

  const seen = new Set<string>()
  for (const playerScore of playerScores) {
    validatePlayerScore(playerScore)
    if (seen.has(playerScore.playerId)) {
      throw new GameCompletionDomainError('중복된 플레이어 식별자는 허용되지 않습니다.')
    }
    seen.add(playerScore.playerId)
  }
}

const validatePlayerScore = (playerScore: PlayerFinalScore | null | undefined): void => {
  // 타입이 막는 입력에 대한 런타임 방어다.
  // Stryker disable all
  if (playerScore === null || playerScore === undefined) {
    throw new GameCompletionDomainError('플레이어 최종 점수는 null일 수 없습니다.')
  }
  // Stryker restore all
  // Stryker disable StringLiteral
  if (typeof playerScore.playerId !== 'string' || playerScore.playerId.trim().length === 0) {
    throw new GameCompletionDomainError('플레이어 식별자는 비어 있을 수 없습니다.')
  }
  // TS의 number에는 소수도 들어온다. 순위를 소수점으로 매기는 경로는 없으므로
  // 여기서 막는다.
  if (!Number.isInteger(playerScore.finalScore) || playerScore.finalScore < 0) {
    throw new GameCompletionDomainError('최종 점수는 0 이상의 정수여야 합니다.')
  }
}
