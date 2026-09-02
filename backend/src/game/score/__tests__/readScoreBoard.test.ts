import { describe, expect, it } from 'vitest'
import { readScoreBoard } from '../readScoreBoard.js'
import { ScoreDomainError } from '../scoreErrors.js'

/**
 * 점수판 읽기의 오류 승격. **규약을 어긴 값만** 호출부의 오류로 바꾸고, 그 밖의 실패
 * (연결 끊김 등)는 그대로 올려보낸다 — 삼키면 Redis 장애가 "점수판이 이상하다"로 보인다.
 */
describe('readScoreBoard', () => {
  const promoted = new Error('승격된 오류')
  const promote = () => promoted

  it('규약을 어긴 값은 호출부가 정한 오류로 바꾼다', async () => {
    const reader = { hgetall: async () => ({ ones: '숫자아님' }) }

    await expect(readScoreBoard(reader, 'game-1', 'player-1', promote)).rejects.toBe(promoted)
  })

  it('읽기 자체가 실패하면 승격하지 않고 그대로 올려보낸다', async () => {
    const broken = new Error('connection lost')
    const reader = {
      hgetall: async () => {
        throw broken
      },
    }

    await expect(readScoreBoard(reader, 'game-1', 'player-1', promote)).rejects.toBe(broken)
  })

  it('해석이 규약 위반이 아닌 이유로 깨져도 점수판 문제로 바꿔 부르지 않는다', async () => {
    const broken = new Error('해시를 읽을 수 없다')
    // 값을 꺼내는 순간 던지는 해시. 규약 위반(`ScoreDomainError`)이 아니므로 그대로 나가야 한다.
    const hostile: Record<string, string> = new Proxy(
      {},
      {
        get() {
          throw broken
        },
      },
    )
    const reader = { hgetall: async () => hostile }

    await expect(readScoreBoard(reader, 'game-1', 'player-1', promote)).rejects.toBe(broken)
  })

  it('빈 해시는 열두 칸이 모두 비어 있는 점수판이다', async () => {
    const reader = { hgetall: async () => ({}) }

    const board = await readScoreBoard(reader, 'game-1', 'player-1', promote)

    expect(board.total).toBe(0)
    expect(Object.values(board.categories).every((score) => score === null)).toBe(true)
  })

  it('승격 훅은 규약 위반의 원인을 함께 받는다', async () => {
    const reader = { hgetall: async () => ({ ones: '숫자아님' }) }
    let cause: unknown

    await expect(
      readScoreBoard(reader, 'game-1', 'player-1', (_playerId, error) => {
        cause = error
        return promoted
      }),
    ).rejects.toBe(promoted)
    expect(cause).toBeInstanceOf(ScoreDomainError)
  })
})
