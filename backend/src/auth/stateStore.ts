import { randomBytes } from 'node:crypto'
import type { Redis } from 'ioredis'

/**
 * OAuth `state` 보관소.
 *
 * 이게 없으면 공격자가 자기 인가 코드를 담은 콜백 URL로 피해자를 유도해
 * **피해자를 공격자 계정으로 로그인시킬 수 있다**(로그인 CSRF). authorize에서
 * 발급한 값만 콜백에서 통과시킨다.
 *
 * **한 번 쓰면 사라진다.** 판정을 `GETDEL`의 반환값으로 하므로 같은 콜백 URL이
 * 동시에 두 번 열려도 한쪽만 통과한다 — 1회용 시맨틱이 계약이다.
 *
 * 값에는 **그 로그인을 시작한 프론트 복귀 주소**를 담는다.
 * 제공자가 콜백으로 돌려주는 것은 `state`·`code`·`error`뿐이고 redirect_uri에
 * 파라미터를 덧붙이면 콘솔 등록값과 달라져 거절되므로(카카오 KOE006),
 * **출처를 왕복시킬 수 있는 자리가 여기뿐**이다. 값은 우리가 발급한 것만
 * 되돌아오므로 클라이언트가 위조할 수 없다(고를 수 있는 범위는
 * `auth/returnTo.ts`가 목록으로 좁힌다).
 */
export class OAuthStateStore {
  constructor(private readonly redis: Redis) {}

  /** @param returnUrl 콜백이 이 로그인을 되돌려 보낼 프론트 주소. */
  async issue(returnUrl: string): Promise<string> {
    const state = randomBytes(32).toString('base64url')
    await this.redis.set(key(state), returnUrl, 'EX', OAUTH_STATE_TTL_SECONDS)
    return state
  }

  /** @returns 발급 때 담아 둔 복귀 주소. 우리가 발급하지 않았거나 이미 쓰였으면 `undefined`. */
  async consume(state: string | null | undefined): Promise<string | undefined> {
    if (!state || state.trim().length === 0) return undefined
    return (await this.redis.getdel(key(state))) ?? undefined
  }
}

/** 동의 화면에 머무는 시간을 감안한 값. 길수록 재사용 창이 넓어진다. */
export const OAUTH_STATE_TTL_SECONDS = 5 * 60

const key = (state: string): string => `auth:oauth-state:${state}`
