import { randomBytes } from 'node:crypto'
import type { Redis } from 'ioredis'

/**
 * 콜백이 프론트로 넘기는 **일회용 교환 코드**.
 *
 * 세션 토큰을 리다이렉트 URL에 그대로 실으면 브라우저 히스토리·리퍼러·서버
 * 접근 로그에 남는다. 대신 60초만 사는 코드를 넘기고, 프론트가 그것을 한 번
 * 제시해 진짜 세션 토큰으로 바꾼다.
 *
 * 교환은 `GETDEL`이라 **두 번째 요청은 반드시 실패한다**(1회용 시맨틱이 계약).
 */
export class LoginCodeStore {
  constructor(private readonly redis: Redis) {}

  async issue(sessionToken: string): Promise<string> {
    const code = randomBytes(32).toString('base64url')
    await this.redis.set(key(code), sessionToken, 'EX', LOGIN_CODE_TTL_SECONDS)
    return code
  }

  /** @returns 세션 토큰. 없거나 이미 쓰였으면 `undefined`. */
  async consume(code: string | null | undefined): Promise<string | undefined> {
    if (!code || code.trim().length === 0) return undefined
    return (await this.redis.getdel(key(code))) ?? undefined
  }
}

/** 리다이렉트 직후 즉시 교환되므로 짧게 잡는다. */
export const LOGIN_CODE_TTL_SECONDS = 60

const key = (code: string): string => `auth:login-code:${code}`
