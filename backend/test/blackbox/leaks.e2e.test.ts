import { describe, expect, it } from 'vitest'
import { redisTestsEnabled } from '../redisHarness.js'
import { startGame } from './http.js'
import { leaveAll, seatedRoom } from './players.js'
import { escapedHandlerErrors, startInProcessTarget, targetMode } from './target.js'

/**
 * 자원 누수 검사 — 서버를 띄워 방 여러 개를 만들고 끝낸 뒤 **닫으면, 띄우기 전과 같은
 * 상태로 돌아와야 한다**(SQLite가 매 테스트 뒤 메모리·파일 핸들 수를 대조하는 것과 같은
 * 발상). 프로세스가 붙들고 있는 소켓·서버·ref된 타이머 수를 종류별로 센다.
 *
 * 운영 코드의 타이머는 전부 `unref()`라 여기 잡히지 않는다 — 여기서 보는 것은 닫히지 않은
 * 소켓·리스너와, 누군가 실수로 ref로 남긴 타이머다. in-process에서만 의미가 있다.
 */
const describeInProcess =
  targetMode === 'in-process' && redisTestsEnabled ? describe : describe.skip

const resourceCounts = (): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const kind of process.getActiveResourcesInfo()) counts[kind] = (counts[kind] ?? 0) + 1
  return counts
}

const settle = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100 && !condition(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describeInProcess('자원 누수 (in-process)', () => {
  it('방 20개를 만들고 게임을 시작했다 닫으면 소켓·리스너·타이머가 시작 전과 같다', async () => {
    const before = resourceCounts()
    const { target, stop } = await startInProcessTarget()

    for (let room = 0; room < 20; room += 1) {
      const seats = await seatedRoom(target, 2)
      const host = seats[0]
      if (host === undefined) throw new Error('자리가 비어 있다')
      if (room % 2 === 0) await startGame(target, host.entrant)
      await leaveAll(seats)
    }
    expect(escapedHandlerErrors(target)).toEqual([])
    await stop()

    const same = (): boolean => JSON.stringify(resourceCounts()) === JSON.stringify(before)
    await settle(same)
    expect(resourceCounts()).toEqual(before)
  })
})
