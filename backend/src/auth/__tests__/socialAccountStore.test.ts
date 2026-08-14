import type { Pool, RowDataPacket } from 'mysql2/promise'
import { expect, it } from 'vitest'
import { describeMysql, useMysql } from '../../infra/__tests__/mysqlHarness.js'
import { runMigrations } from '../../infra/migrations/runner.js'
import { DataIntegrityViolationError } from '../errors.js'
import { MysqlSocialAccountStore } from '../socialAccountStore.js'
import { PLACEHOLDER_NICKNAME } from '../socialProfile.js'

/**
 * MySQL 구현의 통합 테스트 — 진짜 MySQL이 필요하다(ADR-0005의 게이트를 그대로
 * 쓴다: `MYSQL_TEST_URL`이 없으면 통째로 skip). 여기서만 확인할 수 있는 것은
 * **제약이 실제로 무엇을 막는가**다: `(provider, provider_user_id)` 유니크가
 * 두 번째 가입을 막고, 그 실패가 `DataIntegrityViolationError`로 올라온다.
 */
describeMysql('MysqlSocialAccountStore (실 MySQL)', () => {
  const mysqlPool = useMysql()

  const store = async (): Promise<{ pool: Pool; store: MysqlSocialAccountStore }> => {
    const pool = mysqlPool()
    await runMigrations(pool)
    return { pool, store: new MysqlSocialAccountStore(pool) }
  }

  it('가입은 회원과 소셜 연결을 함께 만든다', async () => {
    const { pool, store: accounts } = await store()

    const user = await accounts.register('KAKAO', '1234567890', '카카오닉', 'https://img')

    expect(user.id).toMatch(/^[0-9a-f-]{36}$/)
    const found = await accounts.findUserByProviderAccount('KAKAO', '1234567890')
    expect(found).toEqual({ id: user.id, nickname: '카카오닉', profileImageUrl: 'https://img' })
    const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM social_accounts')
    expect(Number(rows[0]?.n)).toBe(1)
  })

  it('같은 소셜 계정으로 두 번 가입하면 제약 위반이다', async () => {
    const { store: accounts } = await store()
    await accounts.register('KAKAO', '1234567890', '먼저가입', null)

    await expect(accounts.register('KAKAO', '1234567890', '나중에', null)).rejects.toBeInstanceOf(
      DataIntegrityViolationError,
    )
  })

  /** 유령 회원 금지 — 소셜 연결이 실패하면 users 행도 남으면 안 된다(한 트랜잭션). */
  it('연결이 실패하면 회원도 남기지 않는다', async () => {
    const { pool, store: accounts } = await store()
    await accounts.register('KAKAO', '1234567890', '먼저가입', null)

    await expect(accounts.register('KAKAO', '1234567890', '나중에', null)).rejects.toThrow()

    const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM users')
    expect(Number(rows[0]?.n)).toBe(1)
  })

  it('다른 제공자의 같은 id는 별개 계정이다', async () => {
    const { store: accounts } = await store()
    const kakao = await accounts.register('KAKAO', 'same-id', '카카오', null)

    const google = await accounts.register('GOOGLE', 'same-id', '구글', null)

    expect(google.id).not.toBe(kakao.id)
  })

  it('임시 이름일 때만 제공자 프로필을 받아 적는다', async () => {
    const { store: accounts } = await store()
    const placeholder = await accounts.register('KAKAO', 'p-1', PLACEHOLDER_NICKNAME, null)
    const named = await accounts.register('KAKAO', 'p-2', '내가정한이름', null)

    const adopted = await accounts.adoptProviderProfile(placeholder.id, '진짜닉', 'https://img')
    const untouched = await accounts.adoptProviderProfile(named.id, '제공자이름', 'https://img')

    expect(adopted).toEqual({ id: placeholder.id, nickname: '진짜닉', profileImageUrl: 'https://img' })
    expect(untouched.nickname).toBe('내가정한이름')
    expect(untouched.profileImageUrl).toBeNull()
  })

  it('created_at·updated_at은 UTC 벽시계로 적힌다', async () => {
    const pool = mysqlPool()
    await runMigrations(pool)
    const at = new Date('2026-08-14T01:02:03.000Z')
    const accounts = new MysqlSocialAccountStore(pool, () => at)

    const user = await accounts.register('KAKAO', 'utc-1', '시계', null)

    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT created_at FROM users WHERE id = ?',
      [user.id],
    )
    expect(new Date(String(rows[0]?.created_at)).toISOString()).toBe('2026-08-14T01:02:03.000Z')
  })
})
