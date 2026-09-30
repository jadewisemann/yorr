import { afterEach, expect, it } from 'vitest'
import { leaveAll, type Seat, seatedRoom } from './players.js'
import { describeTarget, escapedHandlerErrors, useTarget } from './target.js'
import { greedyStrategy, YachtGame } from './yachtDriver.js'

/**
 * 야추 한 판을 프로토콜만으로 끝까지 — 방 생성(REST) → 입장(WS) → 시작(REST) →
 * 12라운드 × 인원 → `game.over` → 결과 조회(REST). 매 메시지를 독립 오라클로 검증한다
 * (`yachtDriver.ts`).
 */
describeTarget('야추 한 판 (블랙박스)', () => {
  const target = useTarget()
  let seats: Seat[] = []

  afterEach(async () => {
    await leaveAll(seats)
    seats = []
  })

  it.each([2, 3])('%i명이 끝까지 두고, 순위·점수판·결과 조회가 오라클과 같다', async (count) => {
    seats = await seatedRoom(target(), count)
    const game = new YachtGame(seats)

    const rankings = await game.playToEnd(target(), greedyStrategy)

    expect(rankings).toHaveLength(count)
    await game.expectResultsMatch(target(), rankings)
    expect(escapedHandlerErrors(target())).toEqual([])
  })
})
