import { afterEach, beforeEach, describe } from 'vitest'
import { createSqlitePool, type Pool } from '../sqlite.js'

/**
 * DB 통합 테스트 하네스. 테스트마다 새 인메모리 SQLite 풀을 준다 — 운영과 같은 어댑터이고,
 * 서버도 URL도 필요 없어 언제나 돈다(ADR-0007). 스키마는 풀을 열 때 이미 적용돼 있다.
 */
export const describeDb = describe

export const useDb = (): (() => Pool) => {
  let pool: Pool | undefined
  beforeEach(() => {
    pool = createSqlitePool(':memory:')
  })
  afterEach(async () => {
    await pool?.end()
    pool = undefined
  })
  return () => {
    if (!pool) throw new Error('useDb(): beforeEach 이전에는 풀이 없다')
    return pool
  }
}
