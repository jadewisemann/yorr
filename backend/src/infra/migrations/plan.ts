import { compareVersions, normalizeVersion } from './version.js'

/** 디스크에서 발견한 마이그레이션 파일 하나. */
export interface LocalMigration {
  readonly version: string
  readonly description: string
  /** 파일명 원문 — `flyway_schema_history.script`에 그대로 들어간다. */
  readonly script: string
  readonly checksum: number
  readonly sql: string
}

/** `flyway_schema_history`의 한 행. Java가 쓴 행도 우리가 쓴 행도 같은 모양이다. */
export interface HistoryEntry {
  readonly installedRank: number
  /** repeatable 마이그레이션은 NULL. */
  readonly version: string | null
  readonly description: string
  /** `SQL` · `BASELINE` · `DELETE` … */
  readonly type: string
  readonly script: string
  readonly checksum: number | null
  readonly success: boolean
}

interface ChecksumMismatch {
  readonly version: string
  readonly script: string
  readonly recorded: number | null
  readonly local: number
}

export interface MigrationPlan {
  /** baseline 행이 있으면 그 버전. 이 버전 이하의 파일은 "적용된 것으로 친다". */
  readonly baselineVersion: string | null
  /** 파일이 있고 이력에도 성공으로 남아 있는 것 — 아무 일도 하지 않는다. */
  readonly applied: readonly LocalMigration[]
  /** 이력에 없어 적용해야 하는 것. 전환기에는 **비어 있어야 한다**. */
  readonly pending: readonly LocalMigration[]
  /** baseline 이하라 건너뛰는 것. */
  readonly belowBaseline: readonly LocalMigration[]
  /** 이력에는 있는데 우리 `db/migration`에 파일이 없는 것(스키마 드리프트 신호). */
  readonly missingLocally: readonly HistoryEntry[]
  /** 이력의 체크섬과 파일의 체크섬이 다른 것(파일이 사후 수정됐다는 뜻). */
  readonly checksumMismatches: readonly ChecksumMismatch[]
  /** `success = 0`으로 남은 행. 사람이 손으로 정리하기 전에는 더 진행하지 않는다. */
  readonly failed: readonly HistoryEntry[]
}

/** 이력 체크섬이 NULL(수동 baseline 등)이면 대조하지 않는다. */
const describeMismatch = (
  migration: LocalMigration,
  entry: HistoryEntry,
): ChecksumMismatch | undefined =>
  entry.checksum !== null && entry.checksum !== migration.checksum
    ? {
        version: migration.version,
        script: migration.script,
        recorded: entry.checksum,
        local: migration.checksum,
      }
    : undefined

/** 이력 행 중 버전을 가진 실제 마이그레이션(baseline·삭제 표식 제외). */
const isVersionedMigration = (entry: HistoryEntry): boolean =>
  entry.version !== null && entry.type !== 'BASELINE' && entry.type !== 'DELETE'

/**
 * 파일 목록과 `flyway_schema_history` 내용을 맞대 **무엇이 이미 적용됐고 무엇이
 * 남았는지** 판정한다 — ADR-0005의 핵심 계약이고, MySQL 없이 도는 순수 함수다.
 *
 * Flyway의 판정 규칙을 그대로 따른다:
 * - 같은 **버전**이 이력에 성공으로 있으면 적용된 것이다. 파일명이나 설명이
 *   달라도 버전이 기준이다(`1`과 `1.0`은 같은 버전 — `normalizeVersion`).
 * - baseline 행이 있으면 그 버전 **이하**는 적용 대상이 아니다. Java는
 *   `baseline-version: 0`을 명시해 V1이 조용히 건너뛰어지는 것을 막는다.
 * - 이력에만 있고 파일이 없는 것, 체크섬이 어긋난 것, 실패로 남은 행은
 *   판정 결과에 그대로 실어 보낸다 — 무엇을 오류로 볼지는 호출부가 정한다
 *   (전환기의 `verifyMigrations`는 엄격하고, 로컬 `runMigrations`는 덜 엄격하다).
 */
export const planMigrations = (
  local: readonly LocalMigration[],
  history: readonly HistoryEntry[],
): MigrationPlan => {
  const baselineVersion =
    history
      .filter((entry) => entry.type === 'BASELINE' && entry.version !== null)
      .map((entry) => entry.version as string)
      .sort(compareVersions)
      .at(-1) ?? null

  const byVersion = new Map<string, HistoryEntry>()
  for (const entry of history) {
    if (!isVersionedMigration(entry)) continue
    byVersion.set(normalizeVersion(entry.version as string), entry)
  }

  const applied: LocalMigration[] = []
  const pending: LocalMigration[] = []
  const belowBaseline: LocalMigration[] = []
  const checksumMismatches: ChecksumMismatch[] = []
  const matched = new Set<string>()

  const ordered = [...local].sort((a, b) => compareVersions(a.version, b.version))

  for (const migration of ordered) {
    const key = normalizeVersion(migration.version)
    const entry = byVersion.get(key)
    if (entry === undefined) {
      const skipped =
        baselineVersion !== null && compareVersions(migration.version, baselineVersion) <= 0
      ;(skipped ? belowBaseline : pending).push(migration)
      continue
    }
    matched.add(key)
    // 실패한 행은 applied도 pending도 아니다 — `failed`로만 보고한다.
    if (!entry.success) continue
    applied.push(migration)
    const mismatch = describeMismatch(migration, entry)
    if (mismatch) checksumMismatches.push(mismatch)
  }

  const missingLocally = history.filter(
    (entry) =>
      isVersionedMigration(entry) &&
      entry.success &&
      !matched.has(normalizeVersion(entry.version as string)),
  )

  return {
    baselineVersion,
    applied,
    pending,
    belowBaseline,
    missingLocally,
    checksumMismatches,
    failed: history.filter((entry) => !entry.success),
  }
}
