import type { Pool, PoolConnection } from 'mysql2/promise'
import type { MemberUser } from '../auth/socialProfile.js'
import { DomainError } from '../errors.js'
import { inTransaction as runInTransaction } from '../infra/transaction.js'
import { normalizeNickname } from './session.js'
import { lockUserRow, toMember, type UserRow } from './userRow.js'

/**
 * 회원이 자기 프로필을 보고 고치는 경로.
 *
 * 닉네임은 **두 곳**에 산다: `users` 테이블(영구)과 Redis 세션(인증·표시).
 * 개명은 그래서 dual-write다 — DB만 고치면 다시 로그인하기 전까지 방 명단에 옛
 * 이름이 남고, 세션만 고치면 세션이 만료되는 순간 되돌아간다.
 *
 * 지난 판의 기록은 건드리지 않는다. `match_participants.display_nickname`은 그때
 * 화면에 보였던 이름이라 개명이 과거 전적까지 소급하면 안 된다(persistence.md).
 */

/** `users`에 그런 회원이 없다. REST 본문은 plain-text `user_not_found`. */
export class UserNotFoundError extends DomainError {
  constructor() {
    super('user_not_found')
  }
}

/** 회원 프로필 저장소 — 프로필 경로에 필요한 부분만. */
export interface UserProfileRepository {
  findById(userId: string): Promise<MemberUser | undefined>

  /**
   * 닉네임을 바꾸고 갱신된 회원을 돌려준다. 이름은 **이미 정규화된 값**이어야
   * 한다(규칙은 `session.ts`의 `normalizeNickname` 한 곳에만 있다).
   *
   * @throws UserNotFoundError 그런 회원이 없을 때
   */
  rename(userId: string, nickname: string): Promise<MemberUser>
}

/**
 * 세션 쪽 개명만 쓰는 좁은 포트. `UserService`(session.ts)가 그대로 만족한다 —
 * 프로필이 세션 스토어 전체를 잡으면 MySQL 없는 환경에서 라우트 계약을 시험할 수
 * 없고, 세션 계약의 정본(1.2)에 프로필이 역방향 의존을 만든다.
 */
export interface SessionNicknameWriter {
  renameSession(userId: string, nickname: string): Promise<void>
}

/**
 * MySQL 구현. 스키마는 Flyway V1(`users`)이고 전환기에는 바꾸지 않는다
 * (persistence.md 「전환기 스키마 동결」).
 */
export class MysqlUserProfileStore implements UserProfileRepository {
  constructor(
    private readonly pool: Pool,
    /** 시각 주입 — 테스트가 시간을 고정한다. 풀의 `timezone: 'Z'`가 UTC로 적는다. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  async findById(userId: string): Promise<MemberUser | undefined> {
    const [rows] = await this.pool.query<UserRow[]>(
      'SELECT id, nickname, profile_image_url FROM users WHERE id = ?',
      [userId],
    )
    const row = rows[0]
    return row === undefined ? undefined : toMember(row)
  }

  async rename(userId: string, nickname: string): Promise<MemberUser> {
    return this.inTransaction(async (conn) => {
      const row = await lockUserRow(conn, userId)
      if (row === undefined) throw new UserNotFoundError()
      await conn.query('UPDATE users SET nickname = ?, updated_at = ? WHERE id = ?', [
        nickname,
        this.now(),
        userId,
      ])
      return { id: row.id, nickname, profileImageUrl: row.profile_image_url }
    })
  }

  /**
   * 오류를 승격하지 않는다 — 프로필 개명은 이미 정규화(1~20자)를 통과한 값만 쓰므로
   * 길이 위반 갈래가 없다. `auth/socialAccountStore.ts`는 같은 배선에 제약 위반 승격을
   * 얹는다(`infra/transaction.ts`의 세 번째 인자).
   */
  private async inTransaction<T>(work: (conn: PoolConnection) => Promise<T>): Promise<T> {
    return runInTransaction(this.pool, work)
  }
}

export class UserProfileService {
  constructor(
    private readonly profiles: UserProfileRepository,
    private readonly sessions: SessionNicknameWriter,
  ) {}

  /** @throws UserNotFoundError */
  async read(userId: string): Promise<MemberUser> {
    const user = await this.profiles.findById(userId)
    if (user === undefined) throw new UserNotFoundError()
    return user
  }

  /**
   * 사용자가 직접 이름을 정한다. 이 뒤로는 로그인해도 제공자 이름으로 덮이지
   * 않는다 — 채택은 플레이스홀더일 때만 동작하므로(`socialLoginService.ts`)
   * 개명 자체가 그 상태를 해제한다.
   *
   * 순서가 계약이다:
   * 1. **정규화 먼저.** 없는 회원 + 잘못된 이름이면 `invalid_nickname`이
   * 이긴다 — 규칙 위반은 회원 조회 없이도 판정되는 값 검증이다.
   * 2. **DB → 세션.** 순서를 뒤집어 `renameSession`을 커밋 전에 부르면, 커밋
   * 실패 시 세션에만 새 이름이 남아 영구히 갈라진다. 이 순서라면 최악이
   * "DB는 새 이름·세션은 옛 이름"이고 이는 다음 로그인에 저절로 맞춰진다.
   * 3. 세션이 없어도 성공한다 — `renameSession`은 키가 있을 때만 쓴다.
   *
   * @throws InvalidNicknameError 빈 값·20자 초과
   * @throws UserNotFoundError
   */
  async rename(userId: string, nickname: string | null | undefined): Promise<MemberUser> {
    const normalized = normalizeNickname(nickname)
    const renamed = await this.profiles.rename(userId, normalized)
    await this.sessions.renameSession(userId, normalized)
    return renamed
  }
}
