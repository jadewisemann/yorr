import { expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../../test/redisHarness.js'
import { playersKey, scoresKey } from '../../../room/keys.js'
import { RedisDavinciScoreboard } from '../../davinci/davinciScoreboard.js'
import { RedisDuelScoreboard } from '../../duel/duelScoreboard.js'
import { redisPingPongScoreWriter } from '../../pingpong/pingPongScoreWriter.js'
import { writeRosterScores } from '../rosterScoreWriter.js'

/**
 * 결투·다빈치·탁구가 공유하는 기록 규칙. **거르는 쪽이 핵심**이라 진짜 Redis로 본다 —
 * 명단에 없는 사람의 점수가 되살아나면 `game.over` 순위에 유령이 끼어든다.
 */
describeRedis('writeRosterScores', () => {
  const redis = useRedis()
  const ROOM = 'ROOM01'

  const seatPlayers = async (...playerIds: string[]) => {
    for (const playerId of playerIds) {
      await redis().hset(playersKey(ROOM), playerId, JSON.stringify({ nickname: playerId }))
    }
  }

  it('명단에 있는 사람의 점수를 문자열로 남긴다', async () => {
    await seatPlayers('a', 'b')

    await writeRosterScores(redis(), ROOM, [
      ['a', 7],
      ['b', 0],
    ])

    expect(await redis().hgetall(scoresKey(ROOM))).toEqual({ a: '7', b: '0' })
  })

  it('명단에 없는 사람은 건너뛴다 — 떠난 참가자의 점수를 되살리지 않는다', async () => {
    await seatPlayers('a')

    await writeRosterScores(redis(), ROOM, [
      ['a', 3],
      ['gone', 99],
    ])

    expect(await redis().hgetall(scoresKey(ROOM))).toEqual({ a: '3' })
  })

  it('같은 사람의 점수를 다시 쓰면 덮어쓴다', async () => {
    await seatPlayers('a')

    await writeRosterScores(redis(), ROOM, [['a', 1]])
    await writeRosterScores(redis(), ROOM, [['a', 5]])

    expect(await redis().hget(scoresKey(ROOM), 'a')).toBe('5')
  })

  it('빈 목록은 아무것도 남기지 않는다', async () => {
    await seatPlayers('a')

    await writeRosterScores(redis(), ROOM, [])

    expect(await redis().exists(scoresKey(ROOM))).toBe(0)
  })

  /**
   * 세 게임의 어댑터가 **같은 규칙을 따른다**는 것이 이 함수를 하나로 모은 이유다.
   * 어느 하나가 자기 방식으로 되돌아가면 여기서 걸린다.
   */
  it('세 게임의 어댑터가 모두 명단 밖 점수를 거른다', async () => {
    await seatPlayers('a')
    const scores = new Map([
      ['a', 4],
      ['gone', 9],
    ])

    await new RedisDuelScoreboard(redis()).writeScores(ROOM, scores)
    expect(await redis().hgetall(scoresKey(ROOM))).toEqual({ a: '4' })

    await redis().del(scoresKey(ROOM))
    await new RedisDavinciScoreboard(redis()).writeScores(ROOM, scores)
    expect(await redis().hgetall(scoresKey(ROOM))).toEqual({ a: '4' })

    await redis().del(scoresKey(ROOM))
    await redisPingPongScoreWriter(redis()).record(ROOM, { a: 4, gone: 9 })
    expect(await redis().hgetall(scoresKey(ROOM))).toEqual({ a: '4' })
  })
})
