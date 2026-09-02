import type { MemberUser } from '../../auth/socialProfile.js'
import { UserNotFoundError, type UserProfileRepository } from '../profile.js'

/**
 * `users` 테이블을 대신하는 인메모리 저장소.
 *
 * 이 환경에는 MySQL이 없을 수 있으므로(ADR-0005의 게이트) 회원 저장소만 가짜로
 * 바꿔 끼우고 세션은 진짜 Redis로 돌린다. 프로필 서비스와 프로필 REST가 같은
 * 대역을 쓴다.
 */
export class FakeUserProfiles implements UserProfileRepository {
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
