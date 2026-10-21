import net from 'node:net'
import { createScoreBoard } from '../../src/game/score/index.js'
import type { YachtBotPolicy } from '../../src/game/yacht/bot/botPorts.js'
import { CooperativeYachtBotPolicy } from '../../src/game/yacht/bot/cooperativeBotPolicy.js'
import { ExpectimaxYachtBotPolicy } from '../../src/game/yacht/bot/expectimaxYachtBotPolicy.js'
import { ScorecardValueEvaluator } from '../../src/game/yacht/bot/scorecardValueEvaluator.js'

/**
 * 굶김 측정용 자식 프로세스(`cooperativeBotPolicy.test.ts`가 fork한다). 같은 프로세스에서 재면
 * 클라이언트의 타이머도 함께 막혀 지연이 보이지 않는다 — 실제 사용자처럼 **밖에서** 재야 한다.
 *
 * 받은 바이트를 그대로 돌려주는 에코 서버다. `go`를 받으면 봇 탐색 `count`개를 **같은 시점에
 * 만료되는 타이머**로 건다(여러 방의 봇 턴이 겹친 상황). argv[2]가 `cooperative`면 큐를 거친다.
 */
const mode = process.argv[2]
const count = Number(process.argv[3] ?? '10')
const raw = new ExpectimaxYachtBotPolicy(new ScorecardValueEvaluator(), {
  budgetMs: Number.POSITIVE_INFINITY,
})
// 측정은 탐색 10개가 **전부** 도는 상황이어야 하므로 큐 상한은 푼다(상한은 단위 테스트가 본다).
const policy: YachtBotPolicy =
  mode === 'cooperative'
    ? new CooperativeYachtBotPolicy(raw, undefined, Number.POSITIVE_INFINITY)
    : raw
const board = createScoreBoard({ categories: {}, upperSubtotal: 0, upperBonus: 0, total: 0 })

const startSearches = (): void => {
  for (let index = 0; index < count; index += 1) {
    // 굴림 1 = 가장 깊은 탐색. 주사위를 조금씩 달리해 메모가 겹치지 않게 한다.
    const dice = [1 + (index % 6), 2, 3, 5, 6]
    setTimeout(() => {
      // 동기 정책은 `Promise.resolve`의 인자 평가 중에 던진다 — 그 예외가 타이머 밖으로
      // 새면 자식 프로세스가 죽고 부모는 에코를 기다리다 시간 초과한다.
      try {
        Promise.resolve(policy.decide(board, dice, 1)).catch((error: unknown) => {
          process.stderr.write(`[starvation] search failed: ${String(error)}\n`)
        })
      } catch (error) {
        process.stderr.write(`[starvation] search threw: ${String(error)}\n`)
      }
    }, 20)
  }
}

const buffers = new WeakMap<net.Socket, string>()
const server = net.createServer((socket) =>
  socket.on('data', (data) => {
    // 에코는 바이트 단위 그대로 돌려준다(왕복 측정용).
    socket.write(data)
    // TCP는 바이트 스트림이라 `go`가 쪼개지거나 다른 입력과 합쳐질 수 있다.
    // 개행으로 프레이밍해 완성된 줄만 처리한다.
    const pending = (buffers.get(socket) ?? '') + data.toString()
    const lines = pending.split('\n')
    buffers.set(socket, lines.pop() ?? '')
    for (const line of lines) {
      if (line === 'go') startSearches()
    }
  }),
)
server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  process.send?.(typeof address === 'object' && address !== null ? address.port : 0)
})
