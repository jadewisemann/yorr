import { existsSync } from 'node:fs'
import { loadEnv } from './config/env.js'
import { verifyMigrations } from './infra/migrations/index.js'
import { closeMysqlPool, createMysqlPool } from './infra/mysql.js'
import { createServer } from './server.js'

if (existsSync('.env')) process.loadEnvFile('.env')

const env = loadEnv()
// 풀은 여기서 만들어 `createServer`에 넘긴다 — 기동 확인과 애플리케이션이 같은 좌표를
// 봐야 하고, 확인이 서버 조립보다 먼저여야 한다. 주입한 쪽이 닫는 규약이므로
// 종료 훅도 여기 있다.
const mysql = createMysqlPool(env)
const server = await createServer(env, { mysql })

/**
 * 전환기 계약: **Node는 스키마를 바꾸지 않는다.** 읽기 전용 확인만 하고, 밀린
 * 마이그레이션·실패 이력이 있으면 던져서 프로세스를 죽인다(ADR-0005).
 * 배포 검증이 HTTP 헬스체크가 아니라 `sleep 15` + 컨테이너 Running 확인뿐이라
 * **기동 실패는 exit≠0으로만 드러난다**(docs/design/operations.md).
 *
 * `server.listen()`이 아니라 여기 있는 이유: `listen()`은 통합 테스트
 * (`ws/__tests__/gateway.test.ts`)가 실제로 부르는 경로다. 거기에 MySQL 왕복을
 * 넣으면 DB 없는 개발·CI 환경의 WS 테스트가 전부 깨진다.
 */
try {
  const { plan } = await verifyMigrations(mysql)
  if (plan.missingLocally.length > 0) {
    // Java가 우리보다 앞서 나간 상태다. 우리 질의를 깨뜨리지는 않으므로 경고만 남긴다.
    server.app.log.warn(
      { scripts: plan.missingLocally.map((entry) => entry.script) },
      'DB 이력에는 있는데 db/migration에 없는 마이그레이션이 있습니다',
    )
  }
  if (plan.checksumMismatches.length > 0) {
    server.app.log.warn(
      { scripts: plan.checksumMismatches.map((mismatch) => mismatch.script) },
      '마이그레이션 체크섬이 이력과 다릅니다',
    )
  }
} catch (error) {
  server.app.log.error({ error }, '마이그레이션 확인 실패 — 기동을 중단합니다')
  await server.close()
  await closeMysqlPool(mysql)
  process.exit(1)
}

const shutdown = async (signal: string): Promise<void> => {
  server.app.log.info({ signal }, '서버를 종료합니다')
  await server.close()
  await closeMysqlPool(mysql)
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

await server.listen()
