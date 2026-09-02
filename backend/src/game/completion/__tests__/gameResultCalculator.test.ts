import { describe, expect, it } from 'vitest'
import {
  calculateGameResult,
  GameCompletionDomainError,
  type PlayerFinalScore,
  type PlayerResult,
  rankTotals,
} from '../gameResultCalculator.js'
import { TIED_RANKINGS } from './completionFixtures.js'

describe('calculateGameResult', () => {
  const score = (playerId: string, finalScore: number): PlayerFinalScore => ({
    playerId,
    finalScore,
  })

  it('2인전의 승자를 가린다', () => {
    const result = calculateGameResult([score('player-b', 120), score('player-a', 180)])

    expect(result.players).toEqual([
      { playerId: 'player-a', finalScore: 180, rank: 1, winner: true, tied: false },
      { playerId: 'player-b', finalScore: 120, rank: 2, winner: false, tied: false },
    ])
    expect(result.isTie).toBe(false)
  })

  it('점수 내림차순으로 순위를 매긴다', () => {
    const result = calculateGameResult([
      score('player-c', 90),
      score('player-a', 210),
      score('player-b', 150),
      score('player-d', 30),
    ])

    expect(result.players.map((player) => player.playerId)).toEqual([
      'player-a',
      'player-b',
      'player-c',
      'player-d',
    ])
    expect(result.players.map((player) => player.rank)).toEqual([1, 2, 3, 4])
  })

  it('입력 순서가 달라도 같은 결과가 나온다', () => {
    const first = [score('player-a', 100), score('player-b', 200), score('player-c', 150)]
    const second = [score('player-c', 150), score('player-a', 100), score('player-b', 200)]

    expect(calculateGameResult(first)).toEqual(calculateGameResult(second))
  })

  it('1위 동점은 공동 우승이다', () => {
    const result = calculateGameResult([
      score('player-b', 200),
      score('player-c', 100),
      score('player-a', 200),
    ])

    expect(result.players).toEqual([
      { playerId: 'player-a', finalScore: 200, rank: 1, winner: true, tied: true },
      { playerId: 'player-b', finalScore: 200, rank: 1, winner: true, tied: true },
      { playerId: 'player-c', finalScore: 100, rank: 3, winner: false, tied: false },
    ])
    expect(result.isTie).toBe(true)
  })

  /** 중간 순위 동점은 순위만 공유하고 **다음 순위를 건너뛴다**(1,2,2,4). isTie는 false. */
  it('중간 순위 동점에 경쟁 순위를 적용한다(게임 동점은 아니다)', () => {
    const result = calculateGameResult([
      score('player-d', 100),
      score('player-c', 150),
      score('player-a', 200),
      score('player-b', 150),
    ])

    expect(result.players).toEqual([
      { playerId: 'player-a', finalScore: 200, rank: 1, winner: true, tied: false },
      { playerId: 'player-b', finalScore: 150, rank: 2, winner: false, tied: true },
      { playerId: 'player-c', finalScore: 150, rank: 2, winner: false, tied: true },
      { playerId: 'player-d', finalScore: 100, rank: 4, winner: false, tied: false },
    ])
    expect(result.isTie).toBe(false)
  })

  it('전원 동점이면 전원 공동 우승이다', () => {
    const result = calculateGameResult([
      score('player-c', 120),
      score('player-a', 120),
      score('player-b', 120),
    ])

    expect(result.players).toEqual([
      { playerId: 'player-a', finalScore: 120, rank: 1, winner: true, tied: true },
      { playerId: 'player-b', finalScore: 120, rank: 1, winner: true, tied: true },
      { playerId: 'player-c', finalScore: 120, rank: 1, winner: true, tied: true },
    ])
    expect(result.isTie).toBe(true)
  })

  it('혼자면 단독 우승이고 동점이 아니다', () => {
    const result = calculateGameResult([score('solo', 0)])

    expect(result.players).toEqual([
      { playerId: 'solo', finalScore: 0, rank: 1, winner: true, tied: false },
    ])
    expect(result.isTie).toBe(false)
  })

  it('동점은 playerId 오름차순으로 정렬한다', () => {
    const result = calculateGameResult([
      score('charlie', 50),
      score('alpha', 50),
      score('bravo', 50),
    ])

    expect(result.players.map((player) => player.playerId)).toEqual(['alpha', 'bravo', 'charlie'])
  })

  it('빈 목록을 거부한다', () => {
    expect(() => calculateGameResult([])).toThrow(GameCompletionDomainError)
    expect(() => calculateGameResult(null as unknown as readonly PlayerFinalScore[])).toThrow(
      GameCompletionDomainError,
    )
  })

  it('null 플레이어를 거부한다', () => {
    const scores = [score('player-a', 100), null as unknown as PlayerFinalScore]

    expect(() => calculateGameResult(scores)).toThrow(GameCompletionDomainError)
  })

  it('빈 playerId를 거부한다', () => {
    for (const playerId of ['', '   ']) {
      expect(() => calculateGameResult([score(playerId, 100)])).toThrow(GameCompletionDomainError)
    }
    expect(() => calculateGameResult([score(null as unknown as string, 100)])).toThrow(
      GameCompletionDomainError,
    )
  })

  /** TS의 number는 정수가 아닐 수 있어 마지막 케이스로 막는다. */
  it('음수·정수 아닌 최종 점수를 거부한다', () => {
    expect(() => calculateGameResult([score('player-a', -1)])).toThrow(GameCompletionDomainError)
    expect(() => calculateGameResult([score('player-a', null as unknown as number)])).toThrow(
      GameCompletionDomainError,
    )
    expect(() => calculateGameResult([score('player-a', 1.5)])).toThrow(GameCompletionDomainError)
  })

  it('중복 playerId를 거부한다', () => {
    expect(() => calculateGameResult([score('player-a', 100), score('player-a', 200)])).toThrow(
      GameCompletionDomainError,
    )
  })

  it('입력 컬렉션을 건드리지 않는다', () => {
    const scores = [score('player-b', 100), score('player-a', 200)]
    const original = [...scores]

    calculateGameResult(scores)

    expect(scores).toEqual(original)
  })

  it('결과 목록은 수정할 수 없다', () => {
    const result = calculateGameResult([score('player-a', 100)])

    expect(() =>
      (result.players as unknown as PlayerResult[]).push({
        playerId: 'player-b',
        finalScore: 50,
        rank: 2,
        winner: false,
        tied: false,
      }),
    ).toThrow(TypeError)
  })
})

/**
 * `rankTotals`는 종료 방송이 쓰는 경로다 — 검증 없이 **있는 그대로** 순위를 매긴다
 * (끝난 방에 아무도 없어도 방송은 나가야 한다).
 */
describe('rankTotals', () => {
  it('동점 공동 순위 + 다음 순위 건너뜀(1,2,2,4)', () => {
    const rankings = rankTotals(
      new Map([
        ['player-a', 180],
        ['player-d', 90],
        ['player-b', 205],
        ['player-c', 180],
      ]),
    )

    expect(rankings).toEqual(TIED_RANKINGS)
  })

  it('빈 총점 맵이면 빈 순위다(예외 아님)', () => {
    expect(rankTotals(new Map())).toEqual([])
  })

  /**
   * 동점끼리는 **playerId 오름차순**이다. 입력 순서를 그대로 두면 같은 점수의 순서가
   * 방마다 달라지고, 결과 화면의 줄 순서가 사람마다 뒤집힌다.
   */
  it('동점은 playerId 오름차순으로 세운다 — 입력 순서와 무관하게', () => {
    const rankings = rankTotals([
      ['player-z', 100],
      ['player-a', 100],
    ])

    expect(rankings.map((ranking) => ranking.playerId)).toEqual(['player-a', 'player-z'])
  })

  /** 같은 playerId가 두 번 오면(있어서는 안 되지만) 순서를 뒤집지 않는다. */
  it('같은 playerId가 겹쳐도 순위를 매긴다', () => {
    expect(
      rankTotals([
        ['player-a', 50],
        ['player-a', 50],
      ]),
    ).toEqual([
      { rank: 1, playerId: 'player-a', total: 50 },
      { rank: 1, playerId: 'player-a', total: 50 },
    ])
  })
})
