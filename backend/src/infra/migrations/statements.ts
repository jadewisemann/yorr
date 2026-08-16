import { MigrationError } from './error.js'

/**
 * 마이그레이션 SQL 파일을 문장 단위로 자른다 — ADR-0005.
 *
 * mysql2는 기본적으로 한 번에 한 문장만 보낸다. `multipleStatements: true`를
 * 켜면 파일을 통째로 던질 수 있지만, 그 플래그는 **애플리케이션 풀 전체**의
 * 성질이 되어 SQL 인젝션의 피해 범위를 넓힌다. 마이그레이션 한 곳을 위해 상시
 * 위험을 켜는 대신 여기서 자른다(Flyway도 자체 파서로 같은 일을 한다).
 *
 * 문자열 리터럴(`'` `"`)·백틱 식별자·`--` `#` 줄 주석·블록 주석 안의 세미콜론은
 * 구분자가 아니다. `DELIMITER`(프로시저·트리거)는 지원하지 않는다 — 조용히
 * 잘못 자르는 대신 던진다.
 */
export const splitSqlStatements = (sql: string): string[] => {
  const statements: string[] = []
  let current = ''
  let index = 0

  const flush = (): void => {
    const trimmed = current.trim()
    if (trimmed.length > 0) statements.push(trimmed)
    current = ''
  }

  while (index < sql.length) {
    const skipTo = scanNonStatementSpan(sql, index)
    if (skipTo !== undefined) {
      // 주석·리터럴은 통째로 옮긴다(문장 안에 남아 있어야 오류 메시지가 읽힌다).
      current += sql.slice(index, skipTo)
      index = skipTo
      continue
    }
    if (sql[index] === ';') {
      flush()
    } else {
      current += sql[index]
    }
    index += 1
  }
  flush()

  for (const statement of statements) {
    if (/^\s*DELIMITER\b/im.test(statement)) {
      throw new MigrationError('DELIMITER를 쓰는 마이그레이션은 지원하지 않는다(ADR-0005)')
    }
  }
  return statements
}

/**
 * `index`에서 시작하는 "세미콜론이 구분자가 아닌 구간"의 끝을 돌려준다.
 * 그런 구간이 아니면 `undefined`.
 */
const scanNonStatementSpan = (sql: string, index: number): number | undefined => {
  const char = sql[index]
  const next = sql[index + 1]

  if (char === '#' || (char === '-' && next === '-')) {
    const end = sql.indexOf('\n', index)
    return end === -1 ? sql.length : end
  }
  if (char === '/' && next === '*') {
    const end = sql.indexOf('*/', index + 2)
    return end === -1 ? sql.length : end + 2
  }
  if (char === "'" || char === '"' || char === '`') {
    return scanQuoted(sql, index, char)
  }
  return undefined
}

/** 여는 따옴표 위치에서 시작해 닫는 따옴표 **다음** 위치를 돌려준다. */
const scanQuoted = (sql: string, open: number, quote: string): number => {
  let cursor = open + 1
  while (cursor < sql.length) {
    const char = sql[cursor]
    // MySQL의 이스케이프 두 가지: 백슬래시(백틱 안에서는 없다), 따옴표 두 번.
    if (char === '\\' && quote !== '`') {
      cursor += 2
      continue
    }
    if (char === quote) {
      if (sql[cursor + 1] === quote) {
        cursor += 2
        continue
      }
      return cursor + 1
    }
    cursor += 1
  }
  return sql.length
}
