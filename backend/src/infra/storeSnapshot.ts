import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { MemoryRedis } from './memoryRedis.js'

/**
 * 저장소 스냅샷 — 재시작해도 방·세션·진행 중 게임이 이어지게 한다(ADR-0007 갱신).
 *
 * 저장소는 프로세스 안에 있어 그대로 두면 재시작마다 비고, 부팅 재무장(`game/startupResume.ts`)은
 * 빈 저장소만 보게 된다. 그래서 **정상 종료 때와 주기적으로** 파일 하나에 통째로 쓰고, 기동 때 읽는다.
 * 비정상 종료라면 마지막 주기 이후의 변화(최대 한 주기)만 잃는다 — Redis RDB와 같은 절충이다.
 *
 * - 쓰기는 **원자적**이다: 임시 파일에 다 쓰고 나서 rename한다. 쓰다 죽어도 이전 스냅샷이 남는다.
 * - 읽다 틀리면(손상·모양 위반) 빈 저장소로 뜨고, 그 파일은 지우지 않고 옆으로 치워 둔다
 *   (`.corrupt-<시각>`). 사람이 원인을 볼 수 있어야 한다.
 */
export const SNAPSHOT_VERSION = 1

interface SnapshotFile {
  readonly version: number
  readonly savedAt: number
  readonly entries: readonly unknown[]
}

export type SnapshotLoadResult =
  | { readonly kind: 'missing' }
  | { readonly kind: 'restored'; readonly entries: number }
  | { readonly kind: 'corrupt'; readonly error: unknown; readonly movedTo: string }

export const saveStoreSnapshot = (redis: MemoryRedis, path: string, now = Date.now()): number => {
  const entries = redis.core.snapshot()
  const file: SnapshotFile = { version: SNAPSHOT_VERSION, savedAt: now, entries }
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, JSON.stringify(file))
  renameSync(temporary, path)
  return entries.length
}

export const loadStoreSnapshot = (
  redis: MemoryRedis,
  path: string,
  now = Date.now(),
): SnapshotLoadResult => {
  if (!existsSync(path)) return { kind: 'missing' }
  try {
    const file = JSON.parse(readFileSync(path, 'utf8')) as Partial<SnapshotFile>
    if (file.version !== SNAPSHOT_VERSION) {
      throw new Error(`알 수 없는 스냅샷 버전: ${String(file.version)}`)
    }
    if (!Array.isArray(file.entries)) throw new Error('스냅샷에 entries 배열이 없다')
    return { kind: 'restored', entries: redis.core.restore(file.entries) }
  } catch (error) {
    // restore는 모양을 먼저 다 보고 나서 쓰므로 여기 오면 저장소는 비어 있다.
    const movedTo = `${path}.corrupt-${now}`
    renameSync(path, movedTo)
    return { kind: 'corrupt', error, movedTo }
  }
}
