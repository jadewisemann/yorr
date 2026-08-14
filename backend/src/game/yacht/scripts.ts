import type { LuaScript } from '../../infra/lua.js'

/**
 * 방 락 해제 — backend-java `RedisYachtDiceStateStore.UNLOCK`.
 *
 * **토큰 비교가 계약이다**: 자기 락만 지운다. TTL이 먼저 만료돼 다른 요청이 락을
 * 새로 잡은 상황에서 그냥 `DEL`하면 남의 락을 풀어 read-modify-write 두 건이 겹친다.
 */
export const YACHT_UNLOCK_STATE: LuaScript = {
  name: 'yachtUnlockState',
  numberOfKeys: 1,
  lua: `
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
`,
}

export const YACHT_SCRIPTS: readonly LuaScript[] = [YACHT_UNLOCK_STATE]
