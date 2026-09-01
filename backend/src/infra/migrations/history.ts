import type { Connection, RowDataPacket } from 'mysql2/promise'
import { MigrationError } from './error.js'
import type { HistoryEntry } from './plan.js'

/**
 * Flyway 이력 테이블(`flyway_schema_history`) 접근 — ADR-0005.
 *
 * 컬럼·타입·인덱스 이름은 Flyway가 MySQL에 만드는 것과 **똑같아야** 한다.
 * 운영 DB의 이 테이블이 이미 그 모양이고, 우리 러너가 그 위에 그대로 얹히기
 * 때문이다.
 */
export const DEFAULT_HISTORY_TABLE = 'flyway_schema_history'

/** 식별자는 파라미터 바인딩이 안 된다 — 문자열로 끼우기 전에 모양을 검사한다. */
const quoteIdentifier = (name: string): string => {
  if (!/^[A-Za-z0-9_$]+$/.test(name)) {
    throw new MigrationError(`이력 테이블 이름이 이상하다: ${name}`)
  }
  return `\`${name}\``
}

export const historyTableExists = async (conn: Connection, table: string): Promise<boolean> => {
  const [rows] = await conn.query<RowDataPacket[]>(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1',
    [table],
  )
  return rows.length > 0
}

/** 이력 테이블 말고 다른 테이블이 하나라도 있는가(= baseline이 필요한 스키마인가). */
export const schemaHasOtherTables = async (conn: Connection, table: string): Promise<boolean> => {
  const [rows] = await conn.query<RowDataPacket[]>(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> ? LIMIT 1',
    [table],
  )
  return rows.length > 0
}

/** Flyway가 MySQL에 만드는 DDL 그대로. */
export const createHistoryTable = async (conn: Connection, table: string): Promise<void> => {
  const quoted = quoteIdentifier(table)
  await conn.query(
    `CREATE TABLE IF NOT EXISTS ${quoted} (
      \`installed_rank\` INT NOT NULL,
      \`version\` VARCHAR(50),
      \`description\` VARCHAR(200) NOT NULL,
      \`type\` VARCHAR(20) NOT NULL,
      \`script\` VARCHAR(1000) NOT NULL,
      \`checksum\` INT,
      \`installed_by\` VARCHAR(100) NOT NULL,
      \`installed_on\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`execution_time\` INT NOT NULL,
      \`success\` BOOL NOT NULL,
      CONSTRAINT \`${table}_pk\` PRIMARY KEY (\`installed_rank\`)
    ) ENGINE=InnoDB`,
  )
  await conn.query(`CREATE INDEX \`${table}_s_idx\` ON ${quoted} (\`success\`)`).catch(() => {
    // 이미 있으면 그만이다(IF NOT EXISTS가 인덱스에는 없다).
  })
}

export const readHistory = async (conn: Connection, table: string): Promise<HistoryEntry[]> => {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT installed_rank, version, description, type, script, checksum, success
       FROM ${quoteIdentifier(table)} ORDER BY installed_rank`,
  )
  return rows.map((row) => ({
    installedRank: Number(row.installed_rank),
    version: row.version === null ? null : String(row.version),
    description: String(row.description),
    type: String(row.type),
    script: String(row.script),
    checksum: row.checksum === null ? null : Number(row.checksum),
    // BOOL은 TINYINT(1)이라 드라이버가 0/1로 준다.
    success: Boolean(row.success),
  }))
}

export interface HistoryInsert {
  readonly version: string | null
  readonly description: string
  readonly type: string
  readonly script: string
  readonly checksum: number | null
  readonly executionTimeMs: number
  readonly success: boolean
}

/**
 * 이력 행을 추가한다. `installed_rank`는 Flyway와 같이 **현재 최대 + 1**이고,
 * `installed_by`는 접속 계정 이름이다(`SUBSTRING_INDEX(USER(),'@',1)` — Flyway의
 * MySQL 구현과 같은 값).
 */
export const insertHistoryRow = async (
  conn: Connection,
  table: string,
  row: HistoryInsert,
): Promise<void> => {
  const quoted = quoteIdentifier(table)
  const [ranks] = await conn.query<RowDataPacket[]>(
    `SELECT COALESCE(MAX(installed_rank), 0) + 1 AS next_rank FROM ${quoted}`,
  )
  const nextRank = Number(ranks[0]?.next_rank ?? 1)
  await conn.query(
    `INSERT INTO ${quoted}
       (installed_rank, version, description, type, script, checksum,
        installed_by, execution_time, success)
     VALUES (?, ?, ?, ?, ?, ?, SUBSTRING_INDEX(USER(), '@', 1), ?, ?)`,
    [
      nextRank,
      row.version,
      row.description,
      row.type,
      row.script,
      row.checksum,
      row.executionTimeMs,
      row.success ? 1 : 0,
    ],
  )
}
