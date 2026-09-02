import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import type { MemberUser } from '../auth/socialProfile.js'

/**
 * `users` 테이블에서 회원을 읽을 때의 행 모양. 소셜 로그인 저장소와 프로필 저장소가
 * 같은 세 칼럼을 같은 방식으로 읽으므로 여기 둔다.
 *
 * **오류 승격 정책은 여기 없다.** 두 저장소가 제약 위반을 다르게 다루는 것은 의도이며
 * (profile.ts의 `inTransaction` 주석), 이 파일은 행을 도메인 값으로 옮기기만 한다.
 */
export interface UserRow extends RowDataPacket {
  readonly id: string
  readonly nickname: string
  readonly profile_image_url: string | null
}

export const toMember = (row: UserRow): MemberUser => ({
  id: row.id,
  nickname: row.nickname,
  profileImageUrl: row.profile_image_url,
})

/**
 * 트랜잭션 안에서 회원 행을 **잠그고** 읽는다. 잠그지 않으면 같은 순간 다른
 * 트랜잭션이 개명하거나 제공자 프로필을 채택해, 돌려준 값이 방금 쓴 상태와
 * 어긋날 수 있다.
 *
 * 없는 회원을 어떤 오류로 알릴지는 호출자가 정한다 — 두 저장소가 이것을 다르게
 * 다루는 것이 의도다.
 */
export const lockUserRow = async (
  conn: PoolConnection,
  userId: string,
): Promise<UserRow | undefined> => {
  const [rows] = await conn.query<UserRow[]>(
    'SELECT id, nickname, profile_image_url FROM users WHERE id = ? FOR UPDATE',
    [userId],
  )
  return rows[0]
}
