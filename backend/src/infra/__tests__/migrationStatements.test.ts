import { describe, expect, it } from 'vitest'
import { discoverMigrations } from '../migrations/discover.js'
import { MigrationError } from '../migrations/error.js'
import { splitSqlStatements } from '../migrations/statements.js'

describe('splitSqlStatements', () => {
  it('세미콜론으로 자르고 빈 조각은 버린다', () => {
    expect(splitSqlStatements('SELECT 1; SELECT 2;;\n')).toEqual(['SELECT 1', 'SELECT 2'])
  })

  it('마지막 세미콜론이 없어도 문장으로 센다', () => {
    expect(splitSqlStatements('SELECT 1')).toEqual(['SELECT 1'])
  })

  it('문자열 리터럴 안의 세미콜론은 구분자가 아니다', () => {
    expect(splitSqlStatements(`INSERT INTO t VALUES ('a;b'); SELECT 2`)).toEqual([
      `INSERT INTO t VALUES ('a;b')`,
      'SELECT 2',
    ])
  })

  it('이스케이프된 따옴표를 문자열 끝으로 오인하지 않는다', () => {
    expect(splitSqlStatements(`SELECT 'a\\'; b'; SELECT 2`)).toEqual([
      `SELECT 'a\\'; b'`,
      'SELECT 2',
    ])
    expect(splitSqlStatements(`SELECT 'a''; b'; SELECT 2`)).toEqual([`SELECT 'a''; b'`, 'SELECT 2'])
  })

  it('백틱 식별자 안의 세미콜론도 구분자가 아니다', () => {
    expect(splitSqlStatements('SELECT `we;ird`; SELECT 2')).toEqual(['SELECT `we;ird`', 'SELECT 2'])
  })

  it('주석 안의 세미콜론도 구분자가 아니다', () => {
    expect(splitSqlStatements('-- a; b\nSELECT 1;')).toEqual(['-- a; b\nSELECT 1'])
    expect(splitSqlStatements('# a; b\nSELECT 1;')).toEqual(['# a; b\nSELECT 1'])
    expect(splitSqlStatements('/* a; b */ SELECT 1;')).toEqual(['/* a; b */ SELECT 1'])
  })

  it('DELIMITER는 지원하지 않고 조용히 잘못 자르는 대신 던진다', () => {
    expect(() => splitSqlStatements('DELIMITER $$\nCREATE PROCEDURE p() BEGIN END$$')).toThrow(
      MigrationError,
    )
  })

  it('V1·V2는 각각 테이블 2개짜리 문장으로 갈린다', async () => {
    const found = await discoverMigrations()
    for (const migration of found) {
      const statements = splitSqlStatements(migration.sql)
      expect(statements).toHaveLength(2)
      for (const statement of statements) expect(statement).toContain('CREATE TABLE')
    }
  })
})
