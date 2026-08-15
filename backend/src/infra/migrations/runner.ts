import type { Pool, PoolConnection } from 'mysql2/promise'
import { discoverMigrations } from './discover.js'
import { MigrationError } from './error.js'
import {
  createHistoryTable,
  DEFAULT_HISTORY_TABLE,
  historyTableExists,
  insertHistoryRow,
  readHistory,
  schemaHasOtherTables,
} from './history.js'
import { type LocalMigration, type MigrationPlan, planMigrations } from './plan.js'
import { splitSqlStatements } from './statements.js'

export interface MigrationOptions {
  /** SQL 위치. 기본값은 `backend/db/migration/`. */
  readonly directory?: URL | string
  /** 이력 테이블 이름. 기본값 `flyway_schema_history`(Java와 같아야 한다). */
  readonly table?: string
  /** `baseline-on-migrate`의 baseline 버전. Java `application.yaml`과 같이 `0`. */
  readonly baselineVersion?: string
  /**
   * 체크섬 불일치를 **오류로** 볼지. 기본 `false` — 전환기에는 우리 체크섬 계산이
   * Java Flyway와 어긋나도 Node를 못 뜨게 만들면 안 된다(불일치는 보고서에
   * 남고, 호출부가 로그로 알린다). 파이프라인에서는 켜서 드리프트를 잡는다.
   */
  readonly validateChecksums?: boolean
}

export interface MigrationReport {
  readonly plan: MigrationPlan
  /** 이번 호출이 실제로 적용한 마이그레이션(`verifyMigrations`는 항상 빈 배열). */
  readonly applied: readonly string[]
}

const resolve = (options: MigrationOptions) => ({
  directory: options.directory,
  table: options.table ?? DEFAULT_HISTORY_TABLE,
  baselineVersion: options.baselineVersion ?? '0',
  validateChecksums: options.validateChecksums ?? false,
})

/**
 * 디스크와 이력 테이블을 읽어 판정만 한다(쓰기 없음). 이력 테이블이 아직 없으면
 * 이력은 빈 목록이다 — 그 경우 전부 pending이 된다.
 */
const inspectMigrations = async (
  conn: PoolConnection,
  options: MigrationOptions = {},
): Promise<MigrationPlan> => {
  const { directory, table } = resolve(options)
  const local = await discoverMigrations(directory ?? undefined)
  const history = (await historyTableExists(conn, table)) ? await readHistory(conn, table) : []
  return planMigrations(local, history)
}

/**
 * **전환기 기본 동작**: 스키마를 건드리지 않고, DB가 우리가 기대하는 상태인지만
 * 확인한다 — ADR-0005의 "스키마 동결".
 *
 * 던지는 경우:
 * - 적용되지 않은 마이그레이션이 남아 있다(= 마이그레이션 안 된 DB를 가리켰다).
 * - 이력에 실패한 행이 있다(사람이 정리해야 한다).
 * - `validateChecksums`가 켜져 있고 체크섬이 어긋난다.
 *
 * 던지지 **않는** 경우: 이력에는 있는데 우리 `db/migration`에 파일이 없는 것.
 * Java가 우리보다 앞서 나간 상태이고, 남는 테이블이 우리 질의를 깨뜨리지는
 * 않는다 — 보고서에 실어 호출부가 경고 로그를 남기게 한다.
 */
export const verifyMigrations = async (
  pool: Pool,
  options: MigrationOptions = {},
): Promise<MigrationReport> => {
  const { validateChecksums } = resolve(options)
  const conn = await pool.getConnection()
  try {
    const plan = await inspectMigrations(conn, options)
    assertHealthy(plan, validateChecksums)
    if (plan.pending.length > 0) {
      throw new MigrationError(
        `DB에 적용되지 않은 마이그레이션이 있다: ${plan.pending.map((m) => m.script).join(', ')}. ` +
          '전환기에는 Node가 스키마를 바꾸지 않는다 — backend-java(Flyway)를 먼저 올려라(ADR-0005)',
      )
    }
    return { plan, applied: [] }
  } finally {
    conn.release()
  }
}

/**
 * 밀린 마이그레이션을 실제로 적용한다. **전환기 운영 경로가 아니다** — 빈 개발
 * DB와 통합 테스트용 임시 스키마를 세우는 용도다(ADR-0005).
 *
 * MySQL의 DDL은 암묵 커밋이라 트랜잭션으로 되돌릴 수 없다. Flyway와 같이
 * **실패한 마이그레이션도 `success = 0`으로 이력에 남기고** 던진다 — 반쯤 적용된
 * 스키마가 이력에서 안 보이는 것이 가장 나쁜 상태다.
 */
export const runMigrations = async (
  pool: Pool,
  options: MigrationOptions = {},
): Promise<MigrationReport> => {
  const { table, baselineVersion, validateChecksums } = resolve(options)
  const conn = await pool.getConnection()
  try {
    if (!(await historyTableExists(conn, table))) {
      // `baseline-on-migrate: true`: 스키마에 이미 뭔가 있는데 이력이 없으면
      // baseline을 찍는다. Java가 `baseline-version: 0`을 명시하는 이유는 기본값
      // 1이면 V1이 "적용됨"으로 오인돼 조용히 유실되기 때문이다 — 같은 값을 쓴다.
      const needsBaseline = await schemaHasOtherTables(conn, table)
      await createHistoryTable(conn, table)
      if (needsBaseline) {
        await insertHistoryRow(conn, table, {
          version: baselineVersion,
          description: '<< Flyway Baseline >>',
          type: 'BASELINE',
          script: '<< Flyway Baseline >>',
          checksum: null,
          executionTimeMs: 0,
          success: true,
        })
      }
    }

    const plan = await inspectMigrations(conn, options)
    assertHealthy(plan, validateChecksums)

    const applied: string[] = []
    for (const migration of plan.pending) {
      await applyOne(conn, table, migration)
      applied.push(migration.script)
    }

    return { plan: await inspectMigrations(conn, options), applied }
  } finally {
    conn.release()
  }
}

const applyOne = async (
  conn: PoolConnection,
  table: string,
  migration: LocalMigration,
): Promise<void> => {
  const statements = splitSqlStatements(migration.sql)
  const startedAt = Date.now()
  try {
    for (const statement of statements) await conn.query(statement)
  } catch (error) {
    await insertHistoryRow(conn, table, {
      version: migration.version,
      description: migration.description,
      type: 'SQL',
      script: migration.script,
      checksum: migration.checksum,
      executionTimeMs: Date.now() - startedAt,
      success: false,
    })
    throw new MigrationError(
      `${migration.script} 적용에 실패했다: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  await insertHistoryRow(conn, table, {
    version: migration.version,
    description: migration.description,
    type: 'SQL',
    script: migration.script,
    checksum: migration.checksum,
    executionTimeMs: Date.now() - startedAt,
    success: true,
  })
}

const assertHealthy = (plan: MigrationPlan, validateChecksums: boolean): void => {
  if (plan.failed.length > 0) {
    throw new MigrationError(
      `이력에 실패한 마이그레이션이 남아 있다: ${plan.failed.map((row) => row.script).join(', ')}. ` +
        '스키마를 확인하고 해당 행을 지운 뒤 다시 시도해라',
    )
  }
  if (validateChecksums && plan.checksumMismatches.length > 0) {
    throw new MigrationError(
      `적용된 마이그레이션의 체크섬이 파일과 다르다: ${plan.checksumMismatches
        .map((m) => m.script)
        .join(', ')}. 이미 적용된 SQL 파일은 수정하지 않는다`,
    )
  }
}
