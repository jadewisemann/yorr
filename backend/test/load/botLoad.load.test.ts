import { expect, it } from 'vitest'
import { authHeaders, enterRoom, nicknameFor, request, startGame } from '../blackbox/http.js'
import { leaveAll, type Seat, takeSeat } from '../blackbox/players.js'
import { describeTarget, escapedHandlerErrors, useTarget } from '../blackbox/target.js'
import { type RoundStart, yacht } from '../blackbox/yachtDriver.js'
import { iterationsFromEnv } from '../fuzz/prng.js'
import { oracleScore, YACHT_CATEGORIES, type YachtCategory } from '../oracles/yacht.js'

/**
 * 봇이 다른 방을 굶기지 않는가 — Node는 단일 스레드라 봇 탐색이 도는 동안 다른 방의 메시지가
 * 줄을 선다(docs/design/games/yacht.md 「CPU 예산과 이벤트 루프」).
 *
 * 방 여러 개에 봇을 가득 채워 게임을 돌리고, **게임과 무관한 소켓 하나**가 `sys.ping`을 계속
 * 보내 왕복 시간을 잰다. 이 왕복이 사용자가 느끼는 지연 그 자체다. 사람 호스트는 턴 순서의 맨
 * 앞이라, 자기 턴마다 **즉시 한 번 굴리고 기록한다** — 가만히 두면 25초 타임아웃을 기다리는 동안
 * 봇이 하나도 움직이지 않아 측정이 거짓 초록이 된다(실제로 그랬다). 봇이 실제로 몇 번 굴렸는지를
 * 함께 보고하고, 너무 적으면 실패한다.
 *
 * Botkeep(0.5 vCore)과 같은 조건은 CPU 할당을 묶어서 만든다:
 *   systemd-run --user --scope -p CPUQuota=50% -p MemoryMax=512M <번들 시작 명령>
 *   E2E_BASE_URL=http://127.0.0.1:8080 npm run test:load
 *
 * 조절: LOAD_ROOMS(방 수, 기본 12) · LOAD_SECONDS(측정 시간, 기본 45) · LOAD_P99_MS(상한, 기본 250).
 */

const BOTS_PER_ROOM = 5
const NO_HELD = [false, false, false, false, false]

interface DiceBroadcast {
  readonly playerId: string
  readonly dice: readonly number[]
}

/** 호스트의 턴을 바로바로 넘긴다. `stop()`이 참이 되면 다음 대기에서 빠져나온다. */
const autopilot = async (seat: Seat, stop: () => boolean): Promise<void> => {
  const used = new Set<YachtCategory>()
  let lastRound = 0
  while (!stop()) {
    const start = await seat.ws
      .next(
        yacht('round.start'),
        (message) => {
          const turn = message.payload as RoundStart
          return turn.activePlayerId === seat.entrant.id && turn.roundNumber > lastRound
        },
        5_000,
      )
      .catch(() => null)
    if (start === null) continue
    const turn = start.payload as RoundStart
    lastRound = turn.roundNumber
    const roomId = seat.entrant.roomId
    const rollId = seat.ws.send(
      yacht('dice.roll'),
      { roundNumber: turn.roundNumber, rollCount: 1, held: NO_HELD },
      { roomId },
    )
    const rolled = await seat.ws.next(yacht('dice.broadcast'), (m) => m.msgId === rollId)
    const dice = (rolled.payload as DiceBroadcast).dice
    const open = YACHT_CATEGORIES.filter((category) => !used.has(category))
    const category = open.reduce((best, candidate) =>
      oracleScore(candidate, dice) > oracleScore(best, dice) ? candidate : best,
    )
    used.add(category)
    seat.ws.send(
      yacht('round.submit'),
      { roundNumber: turn.roundNumber, dice, category },
      { roomId },
    )
  }
}

const percentile = (sorted: readonly number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? Number.NaN

describeTarget('봇 부하 아래의 응답성', () => {
  const target = useTarget()

  it('봇 방이 가득 돌아도 무관한 소켓의 ping 왕복 p99가 상한 안이다', async () => {
    const rooms = iterationsFromEnv('LOAD_ROOMS', 12)
    const seconds = iterationsFromEnv('LOAD_SECONDS', 45)
    const p99Limit = iterationsFromEnv('LOAD_P99_MS', 250)

    const hosts: Seat[] = []
    for (let index = 0; index < rooms; index += 1) {
      const host = await enterRoom(target(), nicknameFor(`load${index}`))
      hosts.push(await takeSeat(target(), host))
      for (let bot = 0; bot < BOTS_PER_ROOM; bot += 1) {
        const added = await request(target(), 'POST', `/api/v1/rooms/${host.roomId}/bots`, {
          headers: authHeaders(host),
        })
        expect(added.status, added.text).toBe(200)
      }
      await startGame(target(), host)
    }

    let stopped = false
    const pilots = hosts.map((seat) => autopilot(seat, () => stopped))

    const probe = await takeSeat(target(), await enterRoom(target(), nicknameFor('probe')))
    const rtts: number[] = []
    const deadline = Date.now() + seconds * 1000
    while (Date.now() < deadline) {
      const before = probe.ws.all('sys.pong').length
      const sentAt = performance.now()
      probe.ws.send('sys.ping', { clientTs: Date.now() })
      await probe.ws.next('sys.pong', () => probe.ws.all('sys.pong').length > before, 10_000)
      rtts.push(performance.now() - sentAt)
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    stopped = true
    await Promise.all(pilots)

    // 봇의 굴림 = 호스트가 받은 dice.broadcast 중 자기 것이 아닌 것.
    const botRolls = hosts.reduce(
      (count, seat) =>
        count +
        seat.ws
          .all(yacht('dice.broadcast'))
          .filter((m) => (m.payload as DiceBroadcast).playerId !== seat.entrant.id).length,
      0,
    )
    const sorted = [...rtts].sort((left, right) => left - right)
    const report = {
      rooms,
      bots: rooms * BOTS_PER_ROOM,
      botRolls,
      botRollsPerSecond: botRolls / seconds,
      samples: sorted.length,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      max: sorted.at(-1) ?? Number.NaN,
    }
    // 통과해도 숫자를 남긴다 — 야간 요약과 수동 측정이 이 줄을 읽는다.
    process.stderr.write(`[bot-load] ${JSON.stringify(report)}\n`)

    await leaveAll([...hosts, probe])
    if (target().mode === 'in-process') expect(escapedHandlerErrors(target())).toEqual([])
    // 봇이 거의 안 움직였다면 이 측정은 아무것도 증명하지 않는다. 봇 턴 하나가 연출 지연으로
    // 약 10초를 쓰므로, 방마다 최소 몇 번은 굴렸어야 한다.
    expect(botRolls, '봇이 거의 굴리지 않았다 — 측정이 무의미하다').toBeGreaterThan(rooms * 2)
    expect(report.p99, JSON.stringify(report)).toBeLessThan(p99Limit)
  })
})
