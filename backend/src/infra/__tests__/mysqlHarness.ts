import { randomBytes } from 'node:crypto'
import mysql, { type Connection, type Pool } from 'mysql2/promise'
import { afterAll, afterEach, beforeAll, beforeEach, describe } from 'vitest'

/**
 * MySQL 통합 테스트 하네스 — [ADR-0005](../../../docs/adr/0005-flyway-compatible-migration-runner.md).
 *
 * ADR-0004(Redis)와 **같은 사고방식, 다른 결론**이다. Redis는 테스트가
 * `redis-server`를 직접 띄우지만, MySQL은 데이터 디렉터리 초기화가 필요해
 * "있으면 쓰고 없으면 건너뛴다"만 한다:
 *
 * - `MYSQL_TEST_URL`(예: `mysql://root:pw@127.0.0.1:3306`)이 있으면 그 서버를 쓴다.
 *   `backend-java/compose.yaml`의 mysql 컨테이너가 그대로 대상이 된다.
 * - 없으면 통합 스위트를 건너뛴다(`describeMysql`). 순수 로직 테스트는 계속 돈다.
 * - `MYSQL_TEST_REQUIRED=1`이면 건너뛰지 않고 **실패**한다 — 파이프라인이 조용히
 *   초록이 되는 것을 막는 스위치(ADR-0004의 `REDIS_TEST_REQUIRED`와 같은 역할).
 *
 * 격리: 테스트마다 `yorr_test_<random>` 스키마를 새로 만들고 끝나면 DROP한다
 * (Redis 하네스의 파일별 인스턴스 + `FLUSHALL`에 해당). **URL의 데이터베이스
 * 부분은 쓰지 않는다** — 실수로 운영/개발 스키마를 지우지 않기 위해서다.
 */
const MYSQL_TEST_URL = process.env.MYSQL_TEST_URL

const mysqlTestsEnabled = Boolean(MYSQL_TEST_URL)

if (!mysqlTestsEnabled && process.env.MYSQL_TEST_REQUIRED === '1') {
  throw new Error('MYSQL_TEST_REQUIRED=1인데 MYSQL_TEST_URL이 없다')
}

/** MySQL이 없는 환경에서는 통합 스위트를 건너뛴다(단위 테스트는 계속 돈다). */
export const describeMysql = mysqlTestsEnabled ? describe : describe.skip

interface ServerCredentials {
  readonly host: string
  readonly port: number
  readonly user: string
  readonly password: string
}

const credentials = (): ServerCredentials => {
  const url = new URL(MYSQL_TEST_URL ?? 'mysql://root@127.0.0.1:3306')
  return {
    host: url.hostname,
    port: url.port === '' ? 3306 : Number(url.port),
    user: decodeURIComponent(url.username) === '' ? 'root' : decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  }
}

/**
 * 테스트 하나가 쓸 빈 스키마와 그 위의 풀을 준비한다. 반환된 함수는 테스트
 * 본문에서만 호출한다(`beforeEach` 이후에 값이 생긴다).
 */
export const useMysql = (): (() => Pool) => {
  let admin: Connection | undefined
  let pool: Pool | undefined
  let schema: string | undefined

  beforeAll(async () => {
    admin = await mysql.createConnection({ ...credentials(), timezone: 'Z' })
  }, 30_000)

  beforeEach(async () => {
    schema = `yorr_test_${randomBytes(6).toString('hex')}`
    await admin?.query(`CREATE DATABASE \`${schema}\` DEFAULT CHARSET utf8mb4`)
    pool = mysql.createPool({
      ...credentials(),
      database: schema,
      connectionLimit: 4,
      timezone: 'Z',
      multipleStatements: false,
    })
  })

  afterEach(async () => {
    await pool?.end()
    pool = undefined
    if (schema !== undefined) await admin?.query(`DROP DATABASE IF EXISTS \`${schema}\``)
    schema = undefined
  })

  afterAll(async () => {
    await admin?.end()
  })

  return () => {
    if (!pool) throw new Error('useMysql(): beforeEach 이전에는 풀이 없다')
    return pool
  }
}
