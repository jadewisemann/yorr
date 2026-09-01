import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { crc32 } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { flywayChecksum } from '../migrations/checksum.js'
import { DEFAULT_MIGRATION_DIR } from '../migrations/discover.js'

const migrationDir = fileURLToPath(DEFAULT_MIGRATION_DIR)
const read = (name: string): string => readFileSync(`${migrationDir}${name}`, 'utf8')

describe('flywayChecksum', () => {
  it('줄 종결자를 뺀 줄들의 CRC32다 (Flyway ChecksumCalculator)', () => {
    const content = 'CREATE TABLE t (\n  id INT\n);\n'
    const reference = crc32(Buffer.from('CREATE TABLE t (  id INT);', 'utf8')) | 0
    expect(flywayChecksum(content)).toBe(reference)
  })

  it('줄 종결자 종류와 파일 끝 개행에 영향받지 않는다', () => {
    const lf = flywayChecksum('a\nb\nc')
    expect(flywayChecksum('a\r\nb\r\nc')).toBe(lf)
    expect(flywayChecksum('a\rb\rc')).toBe(lf)
    expect(flywayChecksum('a\nb\nc\n')).toBe(lf)
    expect(flywayChecksum('a\nb\nc\r\n')).toBe(lf)
  })

  it('첫 줄의 BOM은 제외한다', () => {
    expect(flywayChecksum('\uFEFFa\nb')).toBe(flywayChecksum('a\nb'))
  })

  it('빈 줄은 아무 바이트도 더하지 않는다', () => {
    expect(flywayChecksum('a\n\n\nb')).toBe(flywayChecksum('a\nb'))
  })

  it('signed int32다 — history 테이블의 checksum이 INT 컬럼이다', () => {
    for (const sample of ['', 'a', 'V1', read('V1__create_user_tables.sql')]) {
      const value = flywayChecksum(sample)
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(-(2 ** 31))
      expect(value).toBeLessThan(2 ** 31)
    }
  })

  it('내용이 다르면 값이 다르다', () => {
    expect(flywayChecksum('a')).not.toBe(flywayChecksum('b'))
  })

  // 값 고정. 이 테스트가 깨졌다면 db/migration의 SQL이 수정됐다는 뜻이고,
  // 그것은 운영 DB의 flyway_schema_history에 적힌 체크섬과 어긋난다는 뜻이다
  // — 검증이 부팅을 거부한다(ADR-0005).
  it('이미 적용된 V1·V2의 체크섬은 고정값이다', () => {
    expect(flywayChecksum(read('V1__create_user_tables.sql'))).toBe(-1108258305)
    expect(flywayChecksum(read('V2__create_match_tables.sql'))).toBe(-748743682)
  })
})
