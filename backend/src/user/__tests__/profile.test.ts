import { randomUUID } from 'node:crypto'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { beforeEach, expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../test/redisHarness.js'
import { type MemberUser, PLACEHOLDER_NICKNAME } from '../../auth/socialProfile.js'
import { describeMysql, useMysql } from '../../infra/__tests__/mysqlHarness.js'
import { runMigrations } from '../../infra/migrations/runner.js'
import { InvalidNicknameError } from '../errors.js'
import {
  MysqlUserProfileStore,
  UserNotFoundError,
  type UserProfileRepository,
  UserProfileService,
} from '../profile.js'
import { UserService } from '../session.js'

/**
 * 회원 프로필 4종.
 *
 * **이 환경에는 MySQL이 없을 수 있다**(ADR-0005의 게이트 — `MYSQL_TEST_URL`이
 * 있을 때만 통합 스위트가 돈다). 그래서 같은 4종을 두 번 적는다:
 *
 * 1. `UserProfileService` + **인메모리 회원 저장소 + 진짜 Redis** — 항상 돈다.
 *    dual-write에서 **세션 쪽 절반**과 순서·정규화 계약이 여기서 고정된다.
 *    이 스위트를 skip으로 두면 MySQL 없는 개발·CI에서 4.3이 통째로 검증되지 않는다.
 * 2. `MysqlUserProfileStore` + 진짜 MySQL + 진짜 Redis — MySQL이 있을 때만.
 *    **DB 쪽 절반**(행이 실제로 바뀌는가·없는 회원 판정)이 여기서만 확인된다.
 */

/** `users` 테이블을 대신하는 인메모리 저장소. */
class FakeUserProfiles implements UserProfileRepository {
  private readonly rows = new Map<string, MemberUser>()

  seed(user: MemberUser): MemberUser {
    this.rows.set(user.id, user)
    return user
  }

  async findById(userId: string): Promise<MemberUser | undefined> {
    return this.rows.get(userId)
  }

  async rename(userId: string, nickname: string): Promise<MemberUser> {
    const current = this.rows.get(userId)
    if (current === undefined) throw new UserNotFoundError()
    const renamed: MemberUser = { ...current, nickname }
    this.rows.set(userId, renamed)
    return renamed
  }
}

describeRedis('UserProfileService (인메모리 회원 저장소 + 진짜 Redis)', () => {
  const redis = useRedis()
  let users: UserService
  let profiles: FakeUserProfiles
  let service: UserProfileService
  let member: MemberUser
  let sessionToken: string

  /** 공통 준비 — 플레이스홀더 이름으로 가입한 회원 + 열린 세션. */
  beforeEach(async () => {
    users = new UserService(redis())
    profiles = new FakeUserProfiles()
    service = new UserProfileService(profiles, users)
    member = profiles.seed({
      id: randomUUID(),
      nickname: PLACEHOLDER_NICKNAME,
      profileImageUrl: null,
    })
    sessionToken = await users.openMemberSession(member.id, member.nickname)
  })

  const stored = async (): Promise<MemberUser> => {
    const row = await profiles.findById(member.id)
    if (row === undefined) throw new Error('회원이 사라졌다')
    return row
  }

  it('닉네임을_바꾸면_DB와_세션이_함께_바뀐다', async () => {
    await service.rename(member.id, '새이름')

    expect((await stored()).nickname).toBe('새이름')
    // 세션까지 바뀌어야 화면과 방 명단에 바로 반영된다.
    expect((await users.authenticateSession(sessionToken)).nickname).toBe('새이름')
    expect((await users.authenticateSession(sessionToken)).type).toBe('MEMBER')
  })

  /** 사용자가 직접 이름을 정했으면 그 뒤로는 로그인해도 제공자 이름으로 덮이면 안 된다. */
  it('이름을_직접_정하면_더_이상_임시_이름이_아니다', async () => {
    expect((await stored()).nickname).toBe(PLACEHOLDER_NICKNAME)

    await service.rename(member.id, '내가정한이름')

    expect((await stored()).nickname).not.toBe(PLACEHOLDER_NICKNAME)
  })

  it('빈_이름이나_너무_긴_이름은_거절한다', async () => {
    await expect(service.rename(member.id, '  ')).rejects.toBeInstanceOf(InvalidNicknameError)
    await expect(service.rename(member.id, '가'.repeat(21))).rejects.toThrow('invalid_nickname')

    expect((await stored()).nickname).toBe(PLACEHOLDER_NICKNAME)
    // 거절은 dual-write 이전에 끝난다 — 세션에도 새 이름이 새어 나가면 안 된다.
    expect((await users.authenticateSession(sessionToken)).nickname).toBe(PLACEHOLDER_NICKNAME)
  })

  /** 세션이 이미 만료됐어도 프로필 자체는 고칠 수 있어야 한다(다음 로그인에 반영된다). */
  it('세션이_없어도_DB_이름은_바뀐다', async () => {
    await users.closeSession(sessionToken)

    await service.rename(member.id, '세션없이바꾼이름')

    expect((await stored()).nickname).toBe('세션없이바꾼이름')
  })

  // --- Node 계약을 고정하는 추가 케이스 ---

  it('없는 회원은 read·rename 모두 user_not_found다', async () => {
    await expect(service.read('nobody')).rejects.toBeInstanceOf(UserNotFoundError)
    await expect(service.rename('nobody', '이름')).rejects.toThrow('user_not_found')
  })

  /** 규칙 위반은 회원 조회 없이 판정되는 값 검증이라 먼저 터진다. */
  it('없는 회원 + 잘못된 이름이면 invalid_nickname이 이긴다', async () => {
    await expect(service.rename('nobody', '')).rejects.toThrow('invalid_nickname')
  })

  /** 정규화는 session.ts의 함수 하나뿐이다 — 규칙이 두 곳에 복제되면 조용히 갈라진다. */
  it('앞뒤 공백은 다듬고 20자는 통과시킨다(게스트 생성과 같은 규칙)', async () => {
    const renamed = await service.rename(member.id, '  다듬어진이름  ')

    expect(renamed.nickname).toBe('다듬어진이름')
    expect((await users.authenticateSession(sessionToken)).nickname).toBe('다듬어진이름')
    expect((await service.rename(member.id, '가'.repeat(20))).nickname).toBe('가'.repeat(20))
  })

  it('프로필 이미지는 개명에 영향받지 않는다', async () => {
    const withImage = profiles.seed({
      id: randomUUID(),
      nickname: PLACEHOLDER_NICKNAME,
      profileImageUrl: 'https://img/1',
    })

    const renamed = await service.rename(withImage.id, '새이름')

    expect(renamed).toEqual({
      id: withImage.id,
      nickname: '새이름',
      profileImageUrl: 'https://img/1',
    })
  })
})

describeMysql('MysqlUserProfileStore (실 MySQL + 진짜 Redis)', () => {
  const redis = useRedis()
  const mysqlPool = useMysql()

  /** 공통 준비 — 빈 스키마에 V1을 적용하고 회원 1명을 넣는다. */
  const signUp = async (): Promise<{
    pool: Pool
    users: UserService
    service: UserProfileService
    store: MysqlUserProfileStore
    member: MemberUser
    sessionToken: string
  }> => {
    const pool = mysqlPool()
    await runMigrations(pool)
    const member: MemberUser = {
      id: randomUUID(),
      nickname: PLACEHOLDER_NICKNAME,
      profileImageUrl: null,
    }
    const at = new Date('2026-08-14T00:00:00.000Z')
    await pool.query(
      'INSERT INTO users (id, nickname, profile_image_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [member.id, member.nickname, member.profileImageUrl, at, at],
    )
    const users = new UserService(redis())
    const store = new MysqlUserProfileStore(pool)
    return {
      pool,
      users,
      service: new UserProfileService(store, users),
      store,
      member,
      sessionToken: await users.openMemberSession(member.id, member.nickname),
    }
  }

  const nicknameOf = async (pool: Pool, userId: string): Promise<string> => {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT nickname FROM users WHERE id = ?', [
      userId,
    ])
    return String(rows[0]?.nickname)
  }

  it('닉네임을_바꾸면_DB와_세션이_함께_바뀐다', async () => {
    const { pool, users, service, member, sessionToken } = await signUp()

    await service.rename(member.id, '새이름')

    expect(await nicknameOf(pool, member.id)).toBe('새이름')
    expect((await users.authenticateSession(sessionToken)).nickname).toBe('새이름')
    expect((await users.authenticateSession(sessionToken)).type).toBe('MEMBER')
  })

  it('이름을_직접_정하면_더_이상_임시_이름이_아니다', async () => {
    const { pool, service, member } = await signUp()
    expect(await nicknameOf(pool, member.id)).toBe(PLACEHOLDER_NICKNAME)

    await service.rename(member.id, '내가정한이름')

    expect(await nicknameOf(pool, member.id)).not.toBe(PLACEHOLDER_NICKNAME)
  })

  it('빈_이름이나_너무_긴_이름은_거절한다', async () => {
    const { pool, service, member } = await signUp()

    await expect(service.rename(member.id, '  ')).rejects.toThrow('invalid_nickname')
    await expect(service.rename(member.id, '가'.repeat(21))).rejects.toThrow('invalid_nickname')

    expect(await nicknameOf(pool, member.id)).toBe(PLACEHOLDER_NICKNAME)
  })

  it('세션이_없어도_DB_이름은_바뀐다', async () => {
    const { pool, users, service, member, sessionToken } = await signUp()
    await users.closeSession(sessionToken)

    await service.rename(member.id, '세션없이바꾼이름')

    expect(await nicknameOf(pool, member.id)).toBe('세션없이바꾼이름')
  })

  it('없는 회원은 user_not_found이고 행을 만들지 않는다', async () => {
    const { pool, service, store } = await signUp()

    await expect(store.rename('nobody', '이름')).rejects.toBeInstanceOf(UserNotFoundError)
    await expect(service.read('nobody')).rejects.toBeInstanceOf(UserNotFoundError)

    const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM users')
    expect(Number(rows[0]?.n)).toBe(1)
  })

  it('read는 프로필 이미지까지 그대로 돌려준다', async () => {
    const { pool, service, member } = await signUp()
    await pool.query('UPDATE users SET profile_image_url = ? WHERE id = ?', [
      'https://img/1',
      member.id,
    ])

    expect(await service.read(member.id)).toEqual({
      id: member.id,
      nickname: PLACEHOLDER_NICKNAME,
      profileImageUrl: 'https://img/1',
    })
  })
})
