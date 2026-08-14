import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { flywayChecksum } from './checksum.js'
import { MigrationError } from './error.js'
import type { LocalMigration } from './plan.js'
import { compareVersions, parseScriptName } from './version.js'

/**
 * 마이그레이션 SQL의 위치: `backend/db/migration/`.
 *
 * `src/infra/migrations/`와 `dist/infra/migrations/`가 루트에서 같은 깊이라
 * 이 상대 URL 하나로 개발(tsx)과 빌드 산출물(node dist) 양쪽이 같은 곳을 가리킨다
 * (SQL은 `tsc` 산출물에 들어가지 않으므로 `dist` 안에서 찾으면 안 된다).
 */
export const DEFAULT_MIGRATION_DIR = new URL('../../../db/migration/', import.meta.url)

/**
 * 디렉터리에서 versioned 마이그레이션을 읽어 버전 오름차순으로 돌려준다.
 * 파일명 규약에 맞지 않는 것은 무시하고, 같은 버전이 둘이면 던진다
 * (Flyway도 duplicate version으로 죽는다 — 조용히 하나를 고르면 환경마다 다른
 * 스키마가 만들어진다).
 */
export const discoverMigrations = async (
  directory: URL | string = DEFAULT_MIGRATION_DIR,
): Promise<LocalMigration[]> => {
  const root = directory instanceof URL ? fileURLToPath(directory) : directory
  const entries = await readdir(root)
  const found: LocalMigration[] = []
  const seen = new Map<string, string>()

  for (const filename of entries) {
    const parsed = parseScriptName(filename)
    if (!parsed) continue
    const previous = seen.get(parsed.version)
    if (previous !== undefined) {
      throw new MigrationError(
        `마이그레이션 버전 ${parsed.version}이 둘이다: ${previous} · ${filename}`,
      )
    }
    seen.set(parsed.version, filename)
    const sql = await readFile(join(root, filename), 'utf8')
    found.push({ ...parsed, checksum: flywayChecksum(sql), sql })
  }

  return found.sort((a, b) => compareVersions(a.version, b.version))
}
