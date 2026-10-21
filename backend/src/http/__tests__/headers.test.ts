import { describe, expect, it } from 'vitest'
import { header } from '../headers.js'

/**
 * 인증 헤더 조회. Fastify는 같은 이름의 헤더가 한 요청에 두 번 오면 값을
 * **배열**로 넘기는데, 이 API들은 첫 값만 본다 — 그 갈래가 실제 방어선이다.
 */
describe('header', () => {
  it('값이 하나면 그대로 돌려준다', () => {
    expect(header({ authorization: 'Bearer token' }, 'authorization')).toBe('Bearer token')
  })

  it('중복 헤더는 첫 값만 본다', () => {
    expect(header({ authorization: ['Bearer first', 'Bearer second'] }, 'authorization')).toBe(
      'Bearer first',
    )
  })

  it('없는 헤더는 undefined다', () => {
    expect(header({}, 'x-user-id')).toBeUndefined()
  })

  it('빈 배열이면 undefined다 — 인증 실패로 흐른다', () => {
    expect(header({ 'x-user-id': [] }, 'x-user-id')).toBeUndefined()
  })

  it('이름은 소문자로 정확히 일치해야 한다(Fastify가 소문자로 정규화한다)', () => {
    const headers: Record<string, string | string[] | undefined> = { 'x-user-id': 'user-1' }
    expect(header(headers, 'x-user-id')).toBe('user-1')
    expect(header(headers, 'X-User-Id')).toBeUndefined()
  })
})
