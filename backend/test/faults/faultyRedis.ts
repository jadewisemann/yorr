import type { Redis } from 'ioredis'

/**
 * Redis 장애 주입 — SQLite가 "N번째 malloc·N번째 I/O만 실패시키기"를 모든 N에 대해 반복하는
 * 것과 같은 발상이다. 서버가 쓰는 **진짜** 클라이언트를 Proxy로 감싸 N번째 명령 하나만
 * 실패시키고, 나머지는 그대로 통과시킨다.
 *
 * - `before`: 명령을 보내지 않고 거부한다 — 연결이 끊겨 쓰기가 나가지 못한 경우.
 * - `after`: 명령은 **실행되고** 응답만 잃는다 — 쓰기는 됐는데 연결이 끊긴 경우. 부분 실패의
 *   흔적(반쯤 만든 방 등)이 남으므로 더 고약하다.
 */
export type FaultMode = 'before' | 'after'

/** 명령이 아닌 메서드 — 세지 않고 그대로 통과시킨다. */
const NOT_COMMANDS = new Set([
  'connect',
  'disconnect',
  'quit',
  'duplicate',
  'on',
  'once',
  'off',
  'addListener',
  'removeListener',
  'removeAllListeners',
  'prependListener',
  'prependOnceListener',
  'emit',
  'listeners',
  'rawListeners',
  'listenerCount',
  'eventNames',
  'setMaxListeners',
  'getMaxListeners',
  'defineCommand',
  'createBuiltinCommand',
  'pipeline',
  'multi',
  'monitor',
])

export interface FaultyRedis {
  readonly client: Redis
  /** 지금까지 지나간 명령 수(주입 여부와 무관). */
  calls(): number
  /** 실패시킨 명령 이름. 아직 주입하지 않았으면 undefined. */
  injected(): string | undefined
  /** 지금부터 세어 `nth`번째 명령을 실패시킨다. */
  arm(nth: number, mode: FaultMode): void
  disarm(): void
}

export const faultyRedis = (redis: Redis): FaultyRedis => {
  let calls = 0
  let failAt: number | null = null
  let mode: FaultMode = 'before'
  let injected: string | undefined

  const intercept =
    (name: string, command: (...args: unknown[]) => unknown) =>
    (...args: unknown[]): unknown => {
      calls += 1
      if (failAt === null || calls !== failAt) return command.apply(redis, args)
      injected = name
      const fault = new Error(`INJECTED ${mode}: ${name} (#${calls})`)
      if (mode === 'before') return Promise.reject(fault)
      return Promise.resolve(command.apply(redis, args)).then(
        () => Promise.reject(fault),
        () => Promise.reject(fault),
      )
    }

  const client = new Proxy(redis, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target)
      if (typeof value !== 'function') return value
      const method = value as (...args: unknown[]) => unknown
      if (typeof property !== 'string' || property.startsWith('_') || NOT_COMMANDS.has(property)) {
        return method.bind(target)
      }
      return intercept(property, method)
    },
  })

  return {
    client,
    calls: () => calls,
    injected: () => injected,
    arm: (nth, nextMode) => {
      failAt = calls + nth
      mode = nextMode
      injected = undefined
    },
    disarm: () => {
      failAt = null
    },
  }
}
