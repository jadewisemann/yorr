import type { RowDataPacket } from 'mysql2/promise'
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
