import { describe, expect, it } from 'vitest'
import { gameAt, games } from '@/games'

describe('games', () => {
  it('첫 게임은 실제로 플레이할 수 있는 요트 다이스다', () => {
    expect(games[0]).toMatchObject({ key: 'yacht', live: true })
  })

  it('준비 중인 게임은 live=false로만 구분한다', () => {
    expect(games.filter((game) => game.live).map((game) => game.key)).toEqual([
      'yacht',
      'pingpong',
      'duel',
    ])
  })

  it('탁구는 요트 다이스 바로 다음에 노출한다', () => {
    expect(games.slice(0, 2).map((game) => game.key)).toEqual(['yacht', 'pingpong'])
  })

  it('게임 키는 중복되지 않는다 — 탭 id가 키로 만들어진다', () => {
    const keys = games.map((game) => game.key)

    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('gameAt', () => {
  it('인덱스로 게임을 고른다', () => {
    expect(gameAt(1)).toBe(games[1])
  })

  it('범위를 벗어난 인덱스는 첫 게임으로 떨어진다', () => {
    // 히어로 씬은 항상 무언가를 그려야 한다 — undefined가 새면 캔버스가 비어 버린다.
    expect(gameAt(games.length)).toBe(games[0])
    expect(gameAt(-1)).toBe(games[0])
  })
})
