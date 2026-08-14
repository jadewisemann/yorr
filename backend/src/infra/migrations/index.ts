/**
 * Flyway 호환 마이그레이션 러너 — [ADR-0005](../../../docs/adr/0005-flyway-compatible-migration-runner.md).
 *
 * 전환기(같은 MySQL을 backend-java와 Node가 함께 보는 기간)의 계약은
 * **Node가 스키마를 바꾸지 않는다**이다. 서버 기동 경로가 쓰는 것은
 * `verifyMigrations`(읽기 전용 확인)이고, `runMigrations`는 빈 개발 DB와
 * 통합 테스트가 쓴다.
 */
export { flywayChecksum } from './checksum.js'
export { DEFAULT_MIGRATION_DIR, discoverMigrations } from './discover.js'
export { MigrationError } from './error.js'
export { DEFAULT_HISTORY_TABLE } from './history.js'
export type { ChecksumMismatch, HistoryEntry, LocalMigration, MigrationPlan } from './plan.js'
export { planMigrations } from './plan.js'
export type { MigrationOptions, MigrationReport } from './runner.js'
export { inspectMigrations, runMigrations, verifyMigrations } from './runner.js'
export { splitSqlStatements } from './statements.js'
export { compareVersions, normalizeVersion, parseScriptName } from './version.js'
