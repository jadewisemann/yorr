import { expect, it } from 'vitest'
import { useRedis, describeRedis } from '../../../test/redisHarness.js'
import { LOGIN_CODE_TTL_SECONDS, LoginCodeStore } from '../loginCodeStore.js'
import { OAUTH_STATE_TTL_SECONDS, OAuthStateStore } from '../stateStore.js'

/**
 * state·로그인 코드 스토어 — backend-java `OAuthStateStore`·`LoginCodeStore`.
 *
 * **1회용 시맨틱이 계약이다.** state는 로그인 CSRF 방어(콜백 URL 재사용 차단),
 * 로그인 코드는 유출된 코드의 수명 제한이 목적이라 "두 번째는 반드시 실패"가
 * 지켜져야 의미가 있다. 그래서 모킹이 아니라 진짜 Redis로 고정한다.
 */

describeRedis('OAuthStateStore', () => {
  const redis = useRedis()
  const store = (): OAuthStateStore => new OAuthStateStore(redis())

  it('발급한 state는 한 번만 통과한다', async () => {
    const state = await store().issue()

    expect(await store().consume(state)).toBe(true)
    // 같은 콜백 URL을 다시 열어도 통하지 않는다.
    expect(await store().consume(state)).toBe(false)
  })

  it('우리가 발급하지 않은 값·빈 값은 거절한다', async () => {
    expect(await store().consume('forged')).toBe(false)
    expect(await store().consume('')).toBe(false)
    expect(await store().consume(undefined)).toBe(false)
  })

  /** 동시에 도착한 두 콜백 중 정확히 하나만 통과해야 한다(DEL 반환값으로 판정). */
  it('동시 소비에도 한 번만 통과한다', async () => {
    const state = await store().issue()

    const results = await Promise.all([
      store().consume(state),
      store().consume(state),
      store().consume(state),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('동의 화면 체류 시간을 감안한 TTL을 건다', async () => {
    const state = await store().issue()

    const ttl = await redis().ttl(`auth:oauth-state:${state}`)

    expect(ttl).toBeGreaterThan(OAUTH_STATE_TTL_SECONDS - 5)
    expect(ttl).toBeLessThanOrEqual(OAUTH_STATE_TTL_SECONDS)
  })

  it('발급값은 추측할 수 없는 난수다', async () => {
    const issued = await Promise.all([store().issue(), store().issue()])

    expect(issued[0]).not.toBe(issued[1])
    expect(issued[0]).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})

describeRedis('LoginCodeStore', () => {
  const redis = useRedis()
  const store = (): LoginCodeStore => new LoginCodeStore(redis())

  it('코드를 세션 토큰으로 바꾸고 두 번째 시도는 실패한다', async () => {
    const code = await store().issue('session-token-1')

    expect(await store().consume(code)).toBe('session-token-1')
    expect(await store().consume(code)).toBeUndefined()
  })

  it('없는 코드·빈 코드는 undefined다', async () => {
    expect(await store().consume('nope')).toBeUndefined()
    expect(await store().consume(undefined)).toBeUndefined()
  })

  it('리다이렉트 직후 교환을 전제로 짧은 TTL을 건다', async () => {
    const code = await store().issue('session-token-1')

    const ttl = await redis().ttl(`auth:login-code:${code}`)

    expect(ttl).toBeGreaterThan(LOGIN_CODE_TTL_SECONDS - 5)
    expect(ttl).toBeLessThanOrEqual(LOGIN_CODE_TTL_SECONDS)
  })

  /** 세션 토큰이 URL·로그에 남지 않게 하려는 것이므로 코드 자체가 토큰이면 안 된다. */
  it('코드는 세션 토큰과 다른 난수다', async () => {
    const code = await store().issue('session-token-1')

    expect(code).not.toBe('session-token-1')
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})
