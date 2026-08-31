import type { Redis } from 'ioredis'

/**
 * Lua 스크립트 등록·호출 체계.
 *
 * 방 정원·중복 참가·점수 확정 같은 동시성 있는 전이는 전부 Lua 한 번으로
 * 검증+갱신한다(DESIGN.md 원칙 7). **반환 코드가 곧 계약**이므로 스크립트
 * 텍스트와 반환값 의미를 임의로 손보지 않는다.
 *
 * ioredis의 `defineCommand`는 이름 붙인 스크립트를 EVALSHA로 보내고 NOSCRIPT면
 * 자동으로 EVAL로 재전송한다.
 */
export interface LuaScript {
  readonly name: string
  /**
   * 고정 키 개수. 스크립트가 키 이름을 내부에서 조립해 호출 시점에만 개수를 아는
   * 경우(CLOSE·TOUCH 계열)는 `VARIADIC_KEYS`를 쓴다 — 단일 Redis 노드 전제.
   */
  readonly numberOfKeys: number
  readonly lua: string
}

export const VARIADIC_KEYS = -1

type LuaCallable = (...args: (string | number)[]) => Promise<unknown>

const callableOf = (redis: Redis, name: string): LuaCallable | undefined => {
  const value = (redis as unknown as Record<string, unknown>)[name]
  return typeof value === 'function' ? (value as LuaCallable) : undefined
}

/** 클라이언트 하나에 스크립트를 등록한다. 같은 이름이 이미 있으면 건너뛴다(재등록 안전). */
export const registerLuaScripts = (redis: Redis, scripts: Iterable<LuaScript>): void => {
  for (const script of scripts) {
    if (callableOf(redis, script.name)) continue
    redis.defineCommand(
      script.name,
      script.numberOfKeys === VARIADIC_KEYS
        ? { lua: script.lua }
        : { numberOfKeys: script.numberOfKeys, lua: script.lua },
    )
  }
}

export const runLua = async (
  redis: Redis,
  script: LuaScript,
  keys: readonly string[],
  args: readonly (string | number)[] = [],
): Promise<unknown> => {
  const callable = callableOf(redis, script.name)
  if (!callable) throw new Error(`등록되지 않은 Lua 스크립트: ${script.name}`)
  return script.numberOfKeys === VARIADIC_KEYS
    ? callable.call(redis, keys.length, ...keys, ...args)
    : callable.call(redis, ...keys, ...args)
}

/** 반환 코드가 계약인 스크립트용 — 숫자가 아니면 계약 위반이므로 조용히 넘기지 않는다. */
export const runLuaNumber = async (
  redis: Redis,
  script: LuaScript,
  keys: readonly string[],
  args: readonly (string | number)[] = [],
): Promise<number> => {
  const result = await runLua(redis, script, keys, args)
  if (typeof result !== 'number') {
    throw new Error(`${script.name}의 반환값이 숫자가 아니다: ${JSON.stringify(result)}`)
  }
  return result
}
