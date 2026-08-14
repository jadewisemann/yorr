import { randomBytes } from 'node:crypto'
import type { Redis } from 'ioredis'

/**
 * OAuth `state` 보관소 — backend-java `auth/application/OAuthStateStore`.
 *
 * 이게 없으면 공격자가 자기 인가 코드를 담은 콜백 URL로 피해자를 유도해
 * **피해자를 공격자 계정으로 로그인시킬 수 있다**(로그인 CSRF). authorize에서
 * 발급한 값만 콜백에서 통과시킨다.
 *
 * **한 번 쓰면 사라진다.** 판정을 DEL의 반환값(지운 개수)으로 하므로 같은
 * 콜백 URL이 동시에 두 번 열려도 한쪽만 통과한다 — 1회용 시맨틱이 계약이다.
 */
export class OAuthStateStore {
  constructor(private readonly redis: Redis) {}

  async issue(): Promise<string> {
    const state = randomBytes(32).toString('base64url')
    await this.redis.set(key(state), '1', 'EX', OAUTH_STATE_TTL_SECONDS)
    return state
  }

  /** @returns 우리가 발급했고 아직 쓰이지 않은 state였는지. */
  async consume(state: string | null | undefined): Promise<boolean> {
    if (!state || state.trim().length === 0) return false
    return (await this.redis.del(key(state))) === 1
  }
}

/** 동의 화면에 머무는 시간을 감안한 값. 길수록 재사용 창이 넓어진다. */
export const OAUTH_STATE_TTL_SECONDS = 5 * 60

const key = (state: string): string => `auth:oauth-state:${state}`
