import mysql, { type Pool } from 'mysql2/promise'
import type { Env } from '../config/env.js'

/**
 * MySQL은 계정·전적·랭킹 등 영속 기록 전용이다 — docs/design/persistence.md.
 * 스키마는 backend-java의 Flyway 마이그레이션(V1·V2)을 그대로 이어받고,
 * 전환기에는 Node가 스키마를 바꾸지 않는다([ADR-0005](../../docs/adr/0005-flyway-compatible-migration-runner.md)).
 *
 * `redis.ts`와 같은 결이다: env로 만들고, 주입할 수 있고, 만든 쪽이 닫는다.
 * 풀은 태생이 lazy라 ioredis의 `lazyConnect`에 해당하는 옵션이 따로 없다 —
 * 첫 질의 전에는 커넥션을 열지 않으므로 **MySQL 없이도 서버 기동은 성공한다**
 * (backend-java와 같은 동작).
 */
export const createMysqlPool = (env: Env): Pool =>
  mysql.createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    connectionLimit: 10,
    // 계약: DATETIME(6)은 **UTC 벽시계**다(persistence.md의 finished_at).
    // mysql2 기본값 'local'은 Date ↔ DATETIME 변환에 프로세스 TZ를 쓰는데,
    // 개발 컨테이너는 Asia/Seoul, 운영은 UTC라 그대로 두면 같은 코드가 환경마다
    // 9시간 어긋난 값을 쓴다 — 주간 랭킹 집계가 복구 불가능하게 오염되는 경로다.
    // Java가 명시적으로 Clock.systemUTC()를 쓰는 것과 같은 이유로 'Z'로 못박는다.
    timezone: 'Z',
    // 마이그레이션 SQL은 문장 단위로 잘라 보낸다(migrations/statements.ts) —
    // 인젝션 피해 범위를 넓히는 multipleStatements를 상시로 켜지 않기 위해서다.
    multipleStatements: false,
  })

/** 풀을 만든 쪽이 닫는다. 주입받은 풀은 닫지 않는다(테스트 하네스가 소유자다). */
export const closeMysqlPool = async (pool: Pool): Promise<void> => {
  await pool.end()
}
