import { fork } from 'node:child_process'
import net from 'node:net'
import { describe, expect, it } from 'vitest'
import { createScoreBoard } from '../../../score/index.js'
import type { YachtBotPolicy } from '../botPorts.js'
import { CooperativeYachtBotPolicy } from '../cooperativeBotPolicy.js'
import { type BotDecision, scoreDecision } from '../expectimaxYachtBotPolicy.js'

const board = createScoreBoard({}, 0, 0, 0)
const DICE = [1, 2, 3, 4, 5]

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** 호출마다 끝낼 시점을 테스트가 정하는 정책. 시작·끝 순서를 기록한다. */
const controllable = () => {
  const events: string[] = []
  const gates: ReturnType<typeof deferred<void>>[] = []
  let running = 0
  let maxRunning = 0
  const policy: YachtBotPolicy = {
    decide: async (_board, dice) => {
      const id = dice.join('')
      running += 1
      maxRunning = Math.max(maxRunning, running)
      events.push(`start ${id}`)
      const gate = deferred<void>()
      gates.push(gate)
      await gate.promise
      running -= 1
      events.push(`end ${id}`)
      return scoreDecision('choice', Number(id))
    },
  }
  return { policy, events, gates, maxRunning: () => maxRunning }
}

/** 마이크로태스크·매크로태스크가 다 비워질 때까지. */
const settle = async (): Promise<void> => {
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setImmediate(resolve))
}

describe('CooperativeYachtBotPolicy', () => {
  it('탐색을 한 번에 하나씩, 들어온 순서대로 돌린다', async () => {
    const inner = controllable()
    const queue = new CooperativeYachtBotPolicy(inner.policy)
    const results = [11111, 22222, 33333].map((id) =>
      queue.decide(board, String(id).split('').map(Number), 1),
    )
    expect(queue.queued).toBe(3)

    for (let index = 0; index < 3; index += 1) {
      await settle()
      expect(inner.gates).toHaveLength(index + 1) // 앞의 것이 끝나기 전에는 다음이 시작하지 않는다
      inner.gates[index]?.resolve()
    }
    const decisions = await Promise.all(results)

    expect(inner.maxRunning()).toBe(1)
    expect(inner.events).toEqual([
      'start 11111',
      'end 11111',
      'start 22222',
      'end 22222',
      'start 33333',
      'end 33333',
    ])
    expect(decisions.map((decision) => decision.expectedUtility)).toEqual([11111, 22222, 33333])
    expect(queue.queued).toBe(0)
  })

  it('탐색마다 이벤트 루프에 한 번씩 양보한다', async () => {
    const order: string[] = []
    const inner: YachtBotPolicy = {
      decide: (_board, dice) => {
        order.push(`decide ${dice[0]}`)
        return scoreDecision('choice', 0)
      },
    }
    const queue = new CooperativeYachtBotPolicy(inner, async () => {
      order.push('yield')
    })
    await Promise.all([1, 2, 3].map((first) => queue.decide(board, [first, 2, 3, 4, 5], 1)))
    expect(order).toEqual(['yield', 'decide 1', 'yield', 'decide 2', 'yield', 'decide 3'])
  })

  it('한 탐색의 실패(동기 throw 포함)는 그 호출만 거절하고 큐는 계속 간다', async () => {
    const calls: number[] = []
    const inner: YachtBotPolicy = {
      decide: (_board, dice): BotDecision | Promise<BotDecision> => {
        const id = dice[0] as number
        calls.push(id)
        if (id === 2) throw new Error('동기 실패')
        if (id === 3) return Promise.reject(new Error('비동기 실패'))
        return scoreDecision('choice', id)
      },
    }
    const queue = new CooperativeYachtBotPolicy(inner)
    const outcomes = await Promise.allSettled(
      [1, 2, 3, 4].map((id) => queue.decide(board, [id, 2, 3, 4, 5], 1)),
    )
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      'fulfilled',
      'rejected',
      'rejected',
      'fulfilled',
    ])
    expect(calls).toEqual([1, 2, 3, 4])
    expect(queue.queued).toBe(0)
  })

  it('입력을 바꾸지 않고 그대로 넘긴다', async () => {
    let seen: unknown[] = []
    const queue = new CooperativeYachtBotPolicy({
      decide: (b, d, r) => {
        seen = [b, d, r]
        return scoreDecision('choice', 0)
      },
    })
    await queue.decide(board, DICE, 2)
    expect(seen).toEqual([board, DICE, 2])
  })
})

/**
 * 실제 이벤트 루프 굶김 — 자식 프로세스 서버(`test/load/starvationServer.ts`)가 봇 탐색 10개를
 * 같은 시점에 만료되게 걸고, 이 프로세스가 밖에서 에코 왕복을 잰다. 큐가 없으면 탐색 10개가
 * timers 단계에서 연달아 돌아 왕복이 그 합만큼 밀리고, 큐가 있으면 탐색 하나 길이로 줄어든다.
 */
const maxRoundTripWhileSearching = async (mode: 'naive' | 'cooperative'): Promise<number> => {
  const child = fork(
    new URL('../../../../../test/load/starvationServer.ts', import.meta.url),
    [mode, '10'],
    { execArgv: ['--import', 'tsx'] },
  )
  try {
    const port = await new Promise<number>((resolve) =>
      child.once('message', (p) => resolve(Number(p))),
    )
    const socket = net.connect(port, '127.0.0.1')
    await new Promise((resolve) => socket.once('connect', resolve))
    const echo = (payload: string) =>
      new Promise<void>((resolve) => {
        socket.once('data', () => resolve())
        socket.write(payload)
      })
    // 첫 탐색의 JIT 예열이 측정에 섞이지 않게 한 번 돌려 둔다.
    await echo('go')
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    await echo('go')
    let max = 0
    const end = performance.now() + 800
    while (performance.now() < end) {
      const sentAt = performance.now()
      await echo('p')
      max = Math.max(max, performance.now() - sentAt)
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    socket.destroy()
    return max
  } finally {
    child.kill()
  }
}

describe('이벤트 루프 굶김 (별도 프로세스)', () => {
  it('동시에 만료된 탐색 10개 사이로 다른 소켓의 왕복이 끼어든다', {
    timeout: 60_000,
  }, async () => {
    const naive = await maxRoundTripWhileSearching('naive')
    const cooperative = await maxRoundTripWhileSearching('cooperative')
    // 큐가 없으면 탐색 10개의 합(~100ms+)만큼, 있으면 하나 길이만큼 밀린다. 기계 속도와 무관하게
    // 비율이 크게 갈리므로 비율로 단정한다.
    expect(
      naive,
      `naive=${naive.toFixed(0)}ms cooperative=${cooperative.toFixed(0)}ms`,
    ).toBeGreaterThan(cooperative * 3)
  })
})
