import type { Pool, PoolConnection } from 'mysql2/promise'

/**
 * 트랜잭션 배선 — 연결을 빌리고, 열고, 성공하면 커밋, 실패하면 롤백, 끝에 반납한다.
 *
 * 저장소마다 다른 것은 **실패를 무엇으로 승격하느냐**뿐이라 그것만 훅으로 받는다.
 * 소셜 계정 저장소는 제약 위반을 `DataIntegrityViolationError`로 올리고, 프로필
 * 저장소는 이미 정규화를 통과한 값만 쓰므로 그대로 던진다.
 */
export async function inTransaction<T>(
  pool: Pool,
  work: (conn: PoolConnection) => Promise<T>,
  promote: (error: unknown) => unknown = (error) => error,
): Promise<T> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const result = await work(conn)
    await conn.commit()
    return result
  } catch (error) {
    await conn.rollback().catch(() => {
      // 롤백 실패는 원래 오류를 가리지 않는다.
    })
    throw promote(error)
  } finally {
    conn.release()
  }
}
