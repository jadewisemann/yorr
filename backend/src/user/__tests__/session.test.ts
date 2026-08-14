import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../test/redisHarness.js'
import { InvalidNicknameError, SessionAuthenticationError } from '../errors.js'
import { normalizeNickname, UserService } from '../session.js'

describe('normalizeNickname', () => {
  it('공백을 다듬고 1~20자만 허용한다', () => {
    expect(normalizeNickname(' guest ')).toBe('guest')
    expect(() => normalizeNickname(' ')).toThrow(InvalidNicknameError)
    expect(() => normalizeNickname('123456789012345678901')).toThrow(InvalidNicknameError)
  })

  it('한글도 허용한다 — 문자 종류 제약은 없다', () => {
    expect(normalizeNickname('요르')).toBe('요르')
  })
})

/**
 * 세션 수명은 Redis 키 두 개(`user:{id}` 해시 · `user:token:{hash}` 역인덱스)의
 * 합이라, 둘이 함께 움직이는지는 실제 Redis에서만 확인된다.
 */
describeRedis('UserService', () => {
  const redis = useRedis()
  const userService = (): UserService => new UserService(redis())

  it('회원 세션은 토큰으로도 아이디로도 인증된다', async () => {
    const users = userService()
    const token = await users.openMemberSession('member-1', '카카오회원')

    expect((await users.authenticateSession(token)).type).toBe('MEMBER')
    expect((await users.authenticate('member-1', `Bearer ${token}`)).nickname).toBe('카카오회원')
  })

  it('게스트도 같은 모양으로 인증된다', async () => {
    const users = userService()
    const guest = await users.createGuest(' 요르 ')

    const identity = await users.authenticateSession(guest.sessionToken)
    expect(identity).toEqual({ userId: guest.userId, nickname: '요르', type: 'GUEST' })
  })

  it('원문 토큰은 저장하지 않는다 — 해시 역인덱스만 있다', async () => {
    const users = userService()
    const token = await users.openMemberSession('member-1', '카카오회원')

    expect(await redis().hget('user:member-1', 'tokenHash')).not.toBe(token)
    expect(await redis().get(`user:token:${token}`)).toBeNull()
  })

  it('로그아웃하면 두 경로 모두 막힌다', async () => {
    const users = userService()
    const token = await users.openMemberSession('member-1', '카카오회원')

    await users.closeSession(token)

    await expect(users.authenticateSession(token)).rejects.toThrow(SessionAuthenticationError)
    await expect(users.authenticate('member-1', `Bearer ${token}`)).rejects.toThrow(
      SessionAuthenticationError,
    )
  })

  it('없는 세션을 닫아도 조용히 성공한다', async () => {
    const users = userService()
    await expect(users.closeSession('never-issued')).resolves.toBeUndefined()
    await expect(users.closeSession(null)).resolves.toBeUndefined()
    await expect(users.closeSession('')).resolves.toBeUndefined()
  })

  it('다시 로그인하면 이전 토큰이 무효화된다', async () => {
    const users = userService()
    const first = await users.openMemberSession('member-1', '카카오회원')
    const second = await users.openMemberSession('member-1', '카카오회원')

    expect((await users.authenticateSession(second)).userId).toBe('member-1')
    await expect(users.authenticateSession(first)).rejects.toThrow(SessionAuthenticationError)
  })

  it('게스트와 회원의 수명이 다르다', async () => {
    const users = userService()
    const guest = await users.createGuest('게스트')
    const memberToken = await users.openMemberSession('member-1', '카카오회원')

    expect(await redis().ttl(`user:${guest.userId}`)).toBeLessThanOrEqual(24 * 60 * 60)
    expect(await redis().ttl('user:member-1')).toBeGreaterThan(24 * 60 * 60)
    expect((await users.authenticateSession(memberToken)).type).toBe('MEMBER')
  })

  it('방에 들어가도 회원 수명이 게스트로 깎이지 않는다', async () => {
    const users = userService()
    await users.openMemberSession('member-1', '카카오회원')

    await users.assignRoom('member-1', 'ABC123', 'ABC123', 'member-1')

    expect(await redis().ttl('user:member-1')).toBeGreaterThan(24 * 60 * 60)
    expect(await redis().hget('user:member-1', 'roomCode')).toBe('ABC123')
  })

  it('방을 나가면 방 필드와 퀵매치 티켓이 함께 정리된다', async () => {
    const users = userService()
    const guest = await users.createGuest('게스트')
    await users.assignRoom(guest.userId, 'ABC123', 'ABC123', guest.userId)
    await redis().hset(`quick-match:user:${guest.userId}`, { status: 'MATCHED' })

    await users.clearRoom(guest.userId)

    expect(await redis().hgetall(`user:${guest.userId}`)).not.toHaveProperty('roomId')
    expect(await redis().exists(`quick-match:user:${guest.userId}`)).toBe(0)
  })

  it('인증할 때마다 두 키의 수명이 함께 밀린다', async () => {
    const users = userService()
    const guest = await users.createGuest('게스트')
    await redis().expire(`user:${guest.userId}`, 60)
    await redis().expire(`user:token:${tokenHashOf(guest.sessionToken)}`, 60)

    await users.authenticateSession(guest.sessionToken)

    expect(await redis().ttl(`user:${guest.userId}`)).toBeGreaterThan(60)
    expect(await redis().ttl(`user:token:${tokenHashOf(guest.sessionToken)}`)).toBeGreaterThan(60)
  })

  it('토큰이 어긋나면 인증되지 않는다', async () => {
    const users = userService()
    await users.openMemberSession('member-1', '카카오회원')

    await expect(users.authenticate('member-1', 'Bearer 아무거나')).rejects.toThrow(
      SessionAuthenticationError,
    )
    await expect(users.authenticate('member-1', 'Bearer ')).rejects.toThrow(
      SessionAuthenticationError,
    )
    await expect(users.authenticate('member-1', 'member-1')).rejects.toThrow(
      SessionAuthenticationError,
    )
    await expect(users.authenticateSession('없는-토큰')).rejects.toThrow(SessionAuthenticationError)
  })

  it('세션이 없는 사용자를 rename해도 되살아나지 않는다', async () => {
    const users = userService()
    await users.renameSession('ghost', '유령')
    expect(await redis().exists('user:ghost')).toBe(0)
  })

  it('rename은 열려 있는 세션의 표시 이름을 바꾼다', async () => {
    const users = userService()
    const token = await users.openMemberSession('member-1', '옛이름')

    await users.renameSession('member-1', '새이름')

    expect((await users.authenticateSession(token)).nickname).toBe('새이름')
  })
})

const tokenHashOf = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('base64')
