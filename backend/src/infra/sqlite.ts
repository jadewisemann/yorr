import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { Env } from '../config/env.js'

/**
 * 영속 DB — Node 내장 SQLite 파일 하나([ADR-0007](../../docs/adr/0007-botkeep-single-process.md)).
 * 계정·소셜 연동·전적·주간 랭킹을 담는다(docs/design/persistence.md).
 *
 * 저장소(`Sqlite*Store`)는 MySQL 시절의 `Pool` 모양을 그대로 쓴다: `query`·`getConnection`·
 * `beginTransaction`·`commit`·`rollback`·`release`·`end`. 그 모양을 여기서 정의하고
 * `node:sqlite` 위에 구현한다. 의존성은 없다.
 *
 * 계약:
 * - SELECT는 `[rows]`, 그 밖은 `[{ insertId, affectedRows }]`를 돌려준다.
 * - `Date` 파라미터는 ISO 8601 UTC 문자열로 적는다. 형식이 하나라 문자열 비교가 곧
 *   시각 비교다(`finished_at` 기간 질의).
 * - 제약 위반은 MySQL 시절과 같은 `errno`로 바꿔 던진다 — `auth/errors.ts`와
 *   `matchArchiveStore.ts`가 그 숫자로 판정한다.
 * - `FOR UPDATE`는 지운다. 대신 커넥션이 하나뿐이고 아래 잠금이 트랜잭션 전체를
 *   직렬화하므로 행 잠금보다 강하다.
 *
 * `DatabaseSync`는 커넥션 하나다. `await` 사이에 다른 요청의 질의가 끼어들면 남의
 * 트랜잭션 안에서 실행되므로, 모든 질의와 트랜잭션은 잠금 하나를 차례로 잡는다.
 */

/** SELECT 한 행. 저장소가 `interface UserRow extends RowDataPacket`로 열 이름을 붙인다. */
export interface RowDataPacket {
  readonly [column: string]: unknown
}

/** 쓰기 결과. */
export interface ResultSetHeader {
  readonly insertId: number
  readonly affectedRows: number
}

type QueryResult = readonly RowDataPacket[] | ResultSetHeader

export interface PoolConnection {
  query<T extends QueryResult = RowDataPacket[]>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<[T, undefined]>
  beginTransaction(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
  release(): void
}

export interface Pool {
  query<T extends QueryResult = RowDataPacket[]>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<[T, undefined]>
  getConnection(): Promise<PoolConnection>
  end(): Promise<void>
}

export const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id                TEXT NOT NULL PRIMARY KEY CHECK (length(id) <= 36),
  nickname          TEXT NOT NULL CHECK (length(nickname) <= 20),
  profile_image_url TEXT NULL CHECK (profile_image_url IS NULL OR length(profile_image_url) <= 500),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS social_accounts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT NOT NULL REFERENCES users (id),
  provider         TEXT NOT NULL CHECK (length(provider) <= 20),
  provider_user_id TEXT NOT NULL CHECK (length(provider_user_id) <= 64),
  created_at       TEXT NOT NULL,
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_social_accounts_user ON social_accounts (user_id);
CREATE TABLE IF NOT EXISTS matches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id      TEXT NOT NULL UNIQUE CHECK (length(game_id) <= 64),
  game_code    TEXT NOT NULL CHECK (length(game_code) <= 32),
  room_code    TEXT NOT NULL CHECK (length(room_code) <= 12),
  player_count INTEGER NOT NULL,
  finished_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matches_finished_at ON matches (finished_at);
CREATE TABLE IF NOT EXISTS match_participants (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id         INTEGER NOT NULL REFERENCES matches (id),
  user_id          TEXT NULL REFERENCES users (id),
  player_id        TEXT NOT NULL CHECK (length(player_id) <= 64),
  display_nickname TEXT NOT NULL CHECK (length(display_nickname) <= 20),
  total_score      INTEGER NOT NULL,
  ranking          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_match_participants_match ON match_participants (match_id);
CREATE INDEX IF NOT EXISTS idx_match_participants_user ON match_participants (user_id);
`

/** SQLite 확장 결과 코드 → MySQL 시절의 `errno`(저장소의 판정 코드가 그 숫자다). */
const MYSQL_ERRNO_OF: Readonly<Record<number, number>> = {
  1555: 1062, // SQLITE_CONSTRAINT_PRIMARYKEY → ER_DUP_ENTRY
  2067: 1062, // SQLITE_CONSTRAINT_UNIQUE → ER_DUP_ENTRY
  1299: 1048, // SQLITE_CONSTRAINT_NOTNULL → ER_BAD_NULL_ERROR
  787: 1452, // SQLITE_CONSTRAINT_FOREIGNKEY → ER_NO_REFERENCED_ROW_2
  275: 3819, // SQLITE_CONSTRAINT_CHECK → ER_CHECK_CONSTRAINT_VIOLATED
}

const READS = /^\s*(SELECT|WITH|PRAGMA)\b/i

const toParameter = (value: unknown): SQLInputValue => {
  if (value === undefined || value === null) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'boolean') return value ? 1 : 0
  return value as SQLInputValue
}

const withMysqlErrno = (error: unknown): unknown => {
  if (typeof error !== 'object' || error === null) return error
  const errcode = (error as { errcode?: unknown }).errcode
  const errno = typeof errcode === 'number' ? MYSQL_ERRNO_OF[errcode] : undefined
  if (errno !== undefined) Object.assign(error, { errno })
  return error
}

/** 한 번에 하나만 들어가는 비동기 잠금. 해제 함수를 돌려준다. */
const createLock = () => {
  let tail: Promise<void> = Promise.resolve()
  return async (): Promise<() => void> => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const previous = tail
    tail = previous.then(() => held)
    await previous
    return release
  }
}

/**
 * 파일은 **첫 질의 때** 연다 — MySQL 풀이 첫 질의 전까지 연결하지 않던 것과 같은 결이다.
 * DB를 건드리지 않는 기동·테스트는 파일을 만들지 않는다.
 */
export const createSqlitePool = (path: string): Pool => {
  let opened: DatabaseSync | undefined
  const open = (): DatabaseSync => {
    if (opened !== undefined) return opened
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    const db = new DatabaseSync(path)
    try {
      db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
      db.exec(SQLITE_SCHEMA)
    } catch (error) {
      // 열다 만 핸들을 남기지 않는다 — 그러지 않으면 질의·헬스체크마다 핸들이 하나씩 샌다.
      db.close()
      throw error
    }
    opened = db
    return db
  }
  const acquire = createLock()

  const run = (sql: string, params: readonly unknown[] = []): [unknown, undefined] => {
    const statement = open().prepare(sql.replace(/\s+FOR\s+UPDATE\s*$/i, ''))
    const values = params.map(toParameter)
    try {
      if (READS.test(sql)) return [statement.all(...values), undefined]
      const result = statement.run(...values)
      return [
        { insertId: Number(result.lastInsertRowid), affectedRows: Number(result.changes) },
        undefined,
      ]
    } catch (error) {
      throw withMysqlErrno(error)
    }
  }

  const pool = {
    async query(sql: string, params?: readonly unknown[]) {
      const release = await acquire()
      try {
        return run(sql, params)
      } finally {
        release()
      }
    },
    async getConnection() {
      const release = await acquire()
      let released = false
      // `db.isTransaction`은 Node 22.16부터라 직접 센다 — Botkeep의 Node 버전 폭을 넓힌다.
      let inTransaction = false
      // ROLLBACK이 던져도(예: COMMIT 실패로 SQLite가 이미 되돌려 "no transaction is active")
      // 트랜잭션은 끝난 것으로 본다. 상태를 남기면 release가 또 ROLLBACK을 시도한다.
      const rollback = (): void => {
        if (!inTransaction) return
        try {
          open().exec('ROLLBACK')
        } finally {
          inTransaction = false
        }
      }
      return {
        query: async (sql: string, params?: readonly unknown[]) => run(sql, params),
        beginTransaction: async () => {
          open().exec('BEGIN IMMEDIATE')
          inTransaction = true
        },
        commit: async () => {
          open().exec('COMMIT')
          inTransaction = false
        },
        rollback: async () => rollback(),
        release: () => {
          if (released) return
          released = true
          // 커밋도 롤백도 안 하고 돌려준 트랜잭션이 다음 사용자에게 새지 않게 한다. 되돌리기가
          // 실패해도 **잠금은 반드시 푼다** — 못 풀면 그 뒤의 모든 질의가 영원히 기다린다.
          try {
            rollback()
          } catch {
            // 이미 끝난 트랜잭션이다. 원래 오류는 저장소가 들고 있다.
          } finally {
            release()
          }
        },
      }
    },
    async end() {
      const release = await acquire()
      opened?.close()
      opened = undefined
      release()
    },
  }
  return pool as unknown as Pool
}

/** env의 `SQLITE_PATH`로 만든다. 파일이 놓일 디렉터리는 열 때 만든다. */
export const createDbPool = (env: Env): Pool => createSqlitePool(env.SQLITE_PATH)

/** 풀을 만든 쪽이 닫는다. 주입받은 풀은 닫지 않는다(테스트 하네스가 소유자다). */
export const closeDbPool = (pool: Pool): Promise<void> => pool.end()
