import { describe, expect, it } from 'vitest'
import { discoverMigrations } from '../migrations/discover.js'
import { type HistoryEntry, type LocalMigration, planMigrations } from '../migrations/plan.js'

const local = (version: string, checksum = 1): LocalMigration => ({
  version,
  description: `d${version}`,
  script: `V${version}__d.sql`,
  checksum,
  sql: 'SELECT 1',
})

const applied = (version: string, checksum: number | null = 1): HistoryEntry => ({
  installedRank: Number(version.replace('.', '')) + 1,
  version,
  description: `d${version}`,
  type: 'SQL',
  script: `V${version}__d.sql`,
  checksum,
  success: true,
})

const baseline = (version: string): HistoryEntry => ({
  installedRank: 1,
  version,
  description: '<< Flyway Baseline >>',
  type: 'BASELINE',
  script: '<< Flyway Baseline >>',
  checksum: null,
  success: true,
})

describe('planMigrations — Flyway 이력 호환 판정', () => {
  it('운영 상태(V1·V2가 Java Flyway로 적용됨)를 이미 적용됨으로 읽는다', () => {
    const plan = planMigrations([local('1'), local('2')], [applied('1'), applied('2')])
    expect(plan.pending).toEqual([])
    expect(plan.applied.map((m) => m.version)).toEqual(['1', '2'])
    expect(plan.failed).toEqual([])
    expect(plan.missingLocally).toEqual([])
  })

  it('이력이 비면 전부 pending이고 버전 오름차순이다', () => {
    const plan = planMigrations([local('10'), local('2'), local('1')], [])
    expect(plan.pending.map((m) => m.version)).toEqual(['1', '2', '10'])
  })

  it('중간까지만 적용된 DB에서는 나머지만 pending이다', () => {
    const plan = planMigrations([local('1'), local('2'), local('3')], [applied('1')])
    expect(plan.applied.map((m) => m.version)).toEqual(['1'])
    expect(plan.pending.map((m) => m.version)).toEqual(['2', '3'])
  })

  it('버전은 문자열이 아니라 숫자로 맞춘다 (1 == 1.0)', () => {
    const plan = planMigrations([local('1.0')], [applied('1')])
    expect(plan.pending).toEqual([])
    expect(plan.applied).toHaveLength(1)
  })

  it('baseline 이하는 pending이 아니라 belowBaseline이다', () => {
    const plan = planMigrations([local('1'), local('2')], [baseline('1')])
    expect(plan.belowBaseline.map((m) => m.version)).toEqual(['1'])
    expect(plan.pending.map((m) => m.version)).toEqual(['2'])
    expect(plan.baselineVersion).toBe('1')
  })

  it('baseline 0(Java 설정값)은 아무것도 건너뛰지 않는다', () => {
    const plan = planMigrations([local('1'), local('2')], [baseline('0')])
    expect(plan.belowBaseline).toEqual([])
    expect(plan.pending.map((m) => m.version)).toEqual(['1', '2'])
  })

  it('체크섬이 어긋나면 적용됨으로 보되 불일치로 보고한다', () => {
    const plan = planMigrations([local('1', 42)], [applied('1', 7)])
    expect(plan.pending).toEqual([])
    expect(plan.checksumMismatches).toEqual([
      { version: '1', script: 'V1__d.sql', recorded: 7, local: 42 },
    ])
  })

  it('이력 체크섬이 NULL이면 불일치로 보지 않는다', () => {
    const plan = planMigrations([local('1', 42)], [applied('1', null)])
    expect(plan.checksumMismatches).toEqual([])
  })

  it('실패로 남은 행은 applied도 pending도 아니다 — 사람이 정리해야 한다', () => {
    const failedRow: HistoryEntry = { ...applied('2'), success: false }
    const plan = planMigrations([local('1'), local('2')], [applied('1'), failedRow])
    expect(plan.applied.map((m) => m.version)).toEqual(['1'])
    expect(plan.pending).toEqual([])
    expect(plan.failed).toEqual([failedRow])
  })

  it('이력에만 있고 파일이 없으면 드리프트로 보고한다', () => {
    const plan = planMigrations([local('1')], [applied('1'), applied('2')])
    expect(plan.missingLocally.map((row) => row.version)).toEqual(['2'])
    expect(plan.pending).toEqual([])
  })

  it('baseline 행 자체는 missingLocally가 아니다', () => {
    const plan = planMigrations([local('1')], [baseline('0'), applied('1')])
    expect(plan.missingLocally).toEqual([])
  })
})

describe('discoverMigrations', () => {
  it('db/migration에서 V1·V2를 순서대로 읽는다', async () => {
    const found = await discoverMigrations()
    expect(found.map((m) => m.script)).toEqual([
      'V1__create_user_tables.sql',
      'V2__create_match_tables.sql',
    ])
    expect(found.map((m) => m.version)).toEqual(['1', '2'])
    expect(found[0]?.description).toBe('create user tables')
    expect(found[0]?.sql).toContain('CREATE TABLE users')
  })

  it('전환기 계약: 우리 파일과 운영 이력이 맞아떨어져 pending이 없다', async () => {
    const found = await discoverMigrations()
    const history = found.map((m, index) => ({
      installedRank: index + 1,
      version: m.version,
      description: m.description,
      type: 'SQL',
      script: m.script,
      checksum: m.checksum,
      success: true,
    }))
    const plan = planMigrations(found, history)
    expect(plan.pending).toEqual([])
    expect(plan.checksumMismatches).toEqual([])
    expect(plan.missingLocally).toEqual([])
  })
})
