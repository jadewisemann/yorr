import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { Pool } from 'mysql2/promise'

/**
 * MySQL 대신 쓰는 SQLite — Botkeep 단일 프로세스 배포용(deploy/botkeep/README.md).
 *
 * 저장소 코드(`Mysql*Store`)는 그대로 두고, 그들이 쓰는 mysql2 `Pool`의 **부분집합**만
 * Node 내장 `node:sqlite` 위에 흉내 낸다: `query`·`getConnection`·`beginTransaction`·
 * `commit`·`rollback`·`release`·`end`. 의존성은 하나도 늘지 않는다.
 *
 * 흉내 내는 계약:
 * - SELECT는 `[rows]`, 그 밖은 `[{ insertId, affectedRows }]`를 돌려준다.
 * - `Date` 파라미터는 ISO 8601 UTC 문자열로 적는다. 형식이 하나라 문자열 비교가 곧
 *   시각 비교다(`finished_at` 기간 질의). 풀의 `timezone: 'Z'`와 같은 기준이다.
 * - 제약 위반은 mysql2와 같은 `errno`로 바꿔 던진다 — `auth/errors.ts`와
 *   `matchArchiveStore.ts`가 그 숫자로 판정한다.
 * - `FOR UPDATE`는 지운다. 대신 커넥션이 하나뿐이고 아래 잠금이 트랜잭션 전체를
 *   직렬화하므로 행 잠금보다 강하다.
 *
 * `DatabaseSync`는 커넥션 하나다. `await` 사이에 다른 요청의 질의가 끼어들면 남의
 * 트랜잭션 안에서 실행되므로, 모든 질의와 트랜잭션은 잠금 하나를 차례로 잡는다.
 */
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

const SQLITE_POOL = Symbol.for('yorr.sqlitePool')

/** Flyway 러너가 SQLite 풀을 건너뛰는 데 쓴다 — 스키마는 풀을 열 때 이미 적용된다. */
export const isSqlitePool = (pool: unknown): boolean =>
  typeof pool === 'object' && pool !== null && SQLITE_POOL in pool

/** SQLite 확장 결과 코드 → mysql2 `errno`. */
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

export const createSqlitePool = (path: string): Pool => {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  db.exec(SQLITE_SCHEMA)
  const acquire = createLock()

  const run = (sql: string, params: readonly unknown[] = []): [unknown, undefined] => {
    const statement = db.prepare(sql.replace(/\s+FOR\s+UPDATE\s*$/i, ''))
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
    [SQLITE_POOL]: true,
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
      let open = false
      const rollback = (): void => {
        if (!open) return
        db.exec('ROLLBACK')
        open = false
      }
      return {
        query: async (sql: string, params?: readonly unknown[]) => run(sql, params),
        beginTransaction: async () => {
          db.exec('BEGIN IMMEDIATE')
          open = true
        },
        commit: async () => {
          db.exec('COMMIT')
          open = false
        },
        rollback: async () => rollback(),
        release: () => {
          if (released) return
          released = true
          // 커밋도 롤백도 안 하고 돌려준 트랜잭션이 다음 사용자에게 새지 않게 한다.
          rollback()
          release()
        },
      }
    },
    async end() {
      const release = await acquire()
      db.close()
      release()
    },
  }
  return pool as unknown as Pool
}
