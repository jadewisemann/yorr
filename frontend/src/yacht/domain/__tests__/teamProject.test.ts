import { describe, expect, it } from 'vitest'
import type { YachtCategory } from '../scoring'
import {
  isValidKeep,
  keepBounds,
  nextSeed,
  rotateSeats,
  rouletteWinner,
  TEAM_YACHT_ROUNDS,
  TEAM_YACHT_SEATS,
  tallyVotes,
} from '../teamProject'

const SEATS = ['a', 'b', 'c']
const NONE = [false, false, false, false, false]

describe('킵 제약', () => {
  it('1번 주자는 5개 중 1~3개를 킵한다 — 뒤에 두 명이 굴릴 주사위를 남긴다', () => {
    expect(keepBounds(0, NONE)).toEqual({ min: 1, max: 3 })
    expect(isValidKeep(0, NONE, [0])).toBe(true)
    expect(isValidKeep(0, NONE, [0, 1, 2])).toBe(true)
    expect(isValidKeep(0, NONE, [0, 1, 2, 3])).toBe(false)
  })

  it('아무것도 킵하지 않고 넘길 수 없다', () => {
    expect(isValidKeep(0, NONE, [])).toBe(false)
    expect(isValidKeep(1, [true, false, false, false, false], [])).toBe(false)
  })

  it('2번 주자는 남은 걸 전부 킵할 수 없다 — 3번 주자 몫 1개가 남아야 한다', () => {
    const afterOneKept = [true, false, false, false, false]
    expect(keepBounds(1, afterOneKept)).toEqual({ min: 1, max: 3 })
    expect(isValidKeep(1, afterOneKept, [1, 2, 3, 4])).toBe(false)
    expect(isValidKeep(1, afterOneKept, [1, 2, 3])).toBe(true)

    const afterThreeKept = [true, true, true, false, false]
    expect(keepBounds(1, afterThreeKept)).toEqual({ min: 1, max: 1 })
    expect(isValidKeep(1, afterThreeKept, [3, 4])).toBe(false)
    expect(isValidKeep(1, afterThreeKept, [3])).toBe(true)
  })

  it('앞 사람의 킵은 다시 고를 수 없고 같은 자리를 두 번 셀 수도 없다', () => {
    expect(isValidKeep(1, [true, false, false, false, false], [0])).toBe(false)
    expect(isValidKeep(0, NONE, [1, 1])).toBe(false)
    expect(isValidKeep(0, NONE, [5])).toBe(false)
  })
})

describe('다수결', () => {
  const votes = (a: string, b: string, c: string) =>
    ({ a, b, c }) as Record<string, YachtCategory>

  it('2표 이상 받은 족보가 기록된다', () => {
    expect(tallyVotes(SEATS, votes('choice', 'choice', 'yacht'))).toEqual({ winner: 'choice' })
    expect(tallyVotes(SEATS, votes('ones', 'twos', 'twos'))).toEqual({ winner: 'twos' })
    expect(tallyVotes(SEATS, votes('yacht', 'yacht', 'yacht'))).toEqual({ winner: 'yacht' })
  })

  it('전원 다른 족보면 룰렛 후보 3개가 좌석 순서로 나온다', () => {
    expect(tallyVotes(SEATS, votes('ones', 'twos', 'threes'))).toEqual({
      candidates: ['ones', 'twos', 'threes'],
    })
  })

  it('표가 다 모이지 않았으면 아직 아무것도 정하지 않는다', () => {
    expect(tallyVotes(SEATS, { a: 'ones' } as Record<string, YachtCategory>)).toBeNull()
  })
})

describe('룰렛', () => {
  const candidates = ['ones', 'twos', 'threes'] as const

  it('같은 시드면 같은 결과다', () => {
    const seed = nextSeed(12_345)
    expect(rouletteWinner(seed, candidates)).toBe(rouletteWinner(seed, candidates))
  })

  /**
   * 백엔드 TeamYachtRulesTest와 같은 시드·같은 기대값이다 — 어긋나면 서로 다른 칸에 멈춘다.
   * 2/3 경계를 앞뒤로 하나씩 짚는다(백엔드는 정수 나눗셈, 여기는 부동소수 — 경계가 갈리면 여기서 잡힌다).
   */
  it('백엔드와 같은 값을 낸다', () => {
    expect(rouletteWinner(0, candidates)).toBe('ones')
    expect(rouletteWinner(2_863_311_530, candidates)).toBe('twos')
    expect(rouletteWinner(2_863_311_531, candidates)).toBe('threes')
    expect(rouletteWinner(4_294_967_295, candidates)).toBe('threes')
  })

  it('후보 어디에도 벗어나지 않는다', () => {
    let seed = 1
    for (let attempt = 0; attempt < 500; attempt++) {
      seed = nextSeed(seed)
      expect(candidates).toContain(rouletteWinner(seed, candidates))
    }
  })
})

describe('좌석 로테이션', () => {
  it('1→2→3번 주자가 2→3→1번이 된다', () => {
    expect(rotateSeats(SEATS)).toEqual(['b', 'c', 'a'])
  })

  it('12라운드를 돌면 각 좌석이 정확히 4번 1번 주자를 맡는다', () => {
    const firstRunnerCount: Record<string, number> = {}
    let seats = SEATS
    for (let round = 1; round <= TEAM_YACHT_ROUNDS; round++) {
      firstRunnerCount[seats[0]] = (firstRunnerCount[seats[0]] ?? 0) + 1
      seats = rotateSeats(seats)
    }

    expect(firstRunnerCount).toEqual({ a: 4, b: 4, c: 4 })
    expect(TEAM_YACHT_ROUNDS % TEAM_YACHT_SEATS).toBe(0)
    // 12라운드가 끝나면 순서가 처음으로 돌아온다.
    expect(seats).toEqual(SEATS)
  })
})
