import { randomUUID } from 'node:crypto'
import type { Pool, PoolConnection } from 'mysql2/promise'
import { toMember, type UserRow } from '../user/userRow.js'
import { DataIntegrityViolationError, isMysqlIntegrityViolation } from './errors.js'
import { type MemberUser, PLACEHOLDER_NICKNAME, type SocialProvider } from './socialProfile.js'

/**
 * 소셜 로그인의 **진입 조회** — 결과가 있으면 로그인, 없으면 가입이다.
 */
export interface SocialAccountRepository {
  findUserByProviderAccount(
    provider: SocialProvider,
    providerUserId: string,
  ): Promise<MemberUser | undefined>
}

/**
 * 가입·프로필 채택.
 *
 * 조회(`SocialAccountRepository`)와 **따로** 둔 것이 설계의 핵심이다. 경합에서
 * 진 쪽이 유니크 위반을 잡아 다시 조회하려면 그 쓰기 트랜잭션이 **먼저 끝나
 * 있어야** 한다. 여기 구현이 자기 커넥션에서 트랜잭션을 열고 닫는 것으로
 * 그 효과를 낸다.
 */
export interface SocialAccountRegistrar {
  /**
   * 회원과 소셜 연결을 **한 트랜잭션**으로 만든다 — 소셜 연동 없는 유령 회원이
   * 남지 않아야 한다.
   *
   * @throws DataIntegrityViolationError 제약 위반(유니크·길이·FK). 유니크 위반은
   * 실패가 아니라 "누군가 방금 먼저 가입했다"는 신호로 쓰인다.
   */
  register(
    provider: SocialProvider,
    providerUserId: string,
    nickname: string,
    profileImageUrl: string | null,
  ): Promise<MemberUser>

  /**
   * 임시 이름으로 가입된 회원이 다시 로그인했을 때, 이제 제공자가 주는 진짜
   * 이름을 받아 적는다. **임시 이름일 때만** 바꾼다 — 사용자가 직접 정한 이름을
   * 로그인마다 덮어쓰면 바꿀 방법이 없어진다.
   */
  adoptProviderProfile(
    userId: string,
    nickname: string,
    profileImageUrl: string | null,
  ): Promise<MemberUser>
}

/**
 * MySQL 구현. 스키마는 Flyway V1(`users`·`social_accounts`)이고 전환기에는
 * 바꾸지 않는다(persistence.md 「전환기 스키마 동결」).
 */
export class MysqlSocialAccountStore implements SocialAccountRepository, SocialAccountRegistrar {
  constructor(
    private readonly pool: Pool,
    /** 시각 주입 — 테스트가 시간을 고정한다. 풀의 `timezone: 'Z'`가 UTC로 적는다. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  async findUserByProviderAccount(
    provider: SocialProvider,
    providerUserId: string,
  ): Promise<MemberUser | undefined> {
    const [rows] = await this.pool.query<UserRow[]>(
      `SELECT u.id, u.nickname, u.profile_image_url
         FROM social_accounts sa
         JOIN users u ON u.id = sa.user_id
        WHERE sa.provider = ? AND sa.provider_user_id = ?`,
      [provider, providerUserId],
    )
    const row = rows[0]
    return row === undefined ? undefined : toMember(row)
  }

  async register(
    provider: SocialProvider,
    providerUserId: string,
    nickname: string,
    profileImageUrl: string | null,
  ): Promise<MemberUser> {
    // 식별자는 저장 전에 애플리케이션이 정한다 — 게스트 userId와 같은 UUID 문자열이라
    // 방 명단·Redis 키가 두 신원을 구분 없이 그대로 쓴다(V1 주석).
    const user: MemberUser = { id: randomUUID(), nickname, profileImageUrl }
    const at = this.now()
    await this.inTransaction(async (conn) => {
      await conn.query(
        'INSERT INTO users (id, nickname, profile_image_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [user.id, user.nickname, user.profileImageUrl, at, at],
      )
      await conn.query(
        'INSERT INTO social_accounts (user_id, provider, provider_user_id, created_at) VALUES (?, ?, ?, ?)',
        [user.id, provider, providerUserId, at],
      )
    })
    return user
  }

  async adoptProviderProfile(
    userId: string,
    nickname: string,
    profileImageUrl: string | null,
  ): Promise<MemberUser> {
    return this.inTransaction(async (conn) => {
      const [rows] = await conn.query<UserRow[]>(
        'SELECT id, nickname, profile_image_url FROM users WHERE id = ? FOR UPDATE',
        [userId],
      )
      const row = rows[0]
      if (row === undefined) throw new Error(`user_not_found: ${userId}`)
      const current = toMember(row)
      // 호출자(SocialLoginService)가 이미 판정했지만, 트랜잭션 안에서 다시 본다 —
      // 그 사이 사용자가 직접 개명했을 수 있다.
      if (current.nickname !== PLACEHOLDER_NICKNAME) return current
      const adopted: MemberUser = {
        id: current.id,
        nickname: nickname.trim().length > 0 ? nickname : current.nickname,
        profileImageUrl:
          profileImageUrl !== null && profileImageUrl.trim().length > 0
            ? profileImageUrl
            : current.profileImageUrl,
      }
      await conn.query(
        'UPDATE users SET nickname = ?, profile_image_url = ?, updated_at = ? WHERE id = ?',
        [adopted.nickname, adopted.profileImageUrl, this.now(), adopted.id],
      )
      return adopted
    })
  }

  private async inTransaction<T>(work: (conn: PoolConnection) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection()
    try {
      await conn.beginTransaction()
      const result = await work(conn)
      await conn.commit()
      return result
    } catch (error) {
      await conn.rollback().catch(() => {
        // 롤백 실패는 원래 오류를 가리지 않는다.
      })
      if (isMysqlIntegrityViolation(error)) {
        throw new DataIntegrityViolationError(messageOf(error), { cause: error })
      }
      throw error
    } finally {
      conn.release()
    }
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'data_integrity_violation'
