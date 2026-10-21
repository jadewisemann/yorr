import type { FastifyInstance } from 'fastify'
import type { Env } from '../config/env.js'
import { GameCatalog } from '../game/catalog.js'
import { GameLifecycleService } from '../game/lifecycle.js'
import { GameModuleRegistry } from '../game/module.js'
import { registerHealthRoutes } from '../http/routes/health.js'
import { MemoryRedis, type Redis } from '../infra/memoryRedis.js'
import type { Pool } from '../infra/sqlite.js'
import { createDbPool } from '../infra/sqlite.js'
import {
  dbReadinessCheck,
  type ReadinessResult,
  ReadinessService,
  RealtimeGameMetrics,
  redisReadinessCheck,
} from '../monitoring/index.js'
import { InMemoryRoomCloseScheduler } from '../room/closeScheduler.js'
import { RoomService } from '../room/roomService.js'
import { UserService } from '../user/session.js'
import { RoomBroadcaster } from '../ws/broadcaster.js'
import { HeartbeatMonitor } from '../ws/heartbeat.js'
import { RoomSessionRegistry } from '../ws/registry.js'
import { RealtimeRoomSnapshotService } from '../ws/snapshot.js'

/**
 * `server.ts`의 **기반 인스턴스** 조립 — 저장소·레지스트리·브로드캐스터.
 *
 * 왜 분리했나: `createServer`가 이 조립과 라우트 등록과 수명주기를 한 함수에 담고
 * 있었다. 여기 모인 것들은 **게이트웨이·라우트·조립이 모두 같은 인스턴스를 봐야 하는**
 * 것들이라 한 자리에 있어야 하고, 그래서 조립 자체를 읽기 쉬운 단위로 떼어낸다.
 *
 * 여기서 만든 인스턴스를 다른 곳에서 **다시 만들면** 타입도 테스트도 통과하는데
 * 기능만 조용히 죽는다(방송이 허공으로 가거나 게이지가 0에 머문다).
 */

export interface BaseServices {
  readonly redis: Redis
  readonly ownsRedis: boolean
  readonly db: Pool
  readonly ownsDb: boolean
  readonly users: UserService
  readonly rooms: RoomService
  readonly catalog: GameCatalog
  readonly games: GameModuleRegistry
  readonly lifecycle: GameLifecycleService
  readonly registry: RoomSessionRegistry
  readonly broadcaster: RoomBroadcaster
  readonly snapshots: RealtimeRoomSnapshotService
  readonly heartbeat: HeartbeatMonitor
  readonly closeScheduler: InMemoryRoomCloseScheduler
}

export interface BaseServiceOptions {
  readonly env: Env
  readonly app: FastifyInstance
  readonly redis?: Redis
  readonly db?: Pool
}

/** 저장소·서비스의 기반 인스턴스. 순서가 곧 의존 방향이다. */
export const createBaseServices = ({
  app,
  env,
  redis: injectedRedis,
  db: injectedDb,
}: BaseServiceOptions): BaseServices => {
  const redis = injectedRedis ?? new MemoryRedis()
  const ownsRedis = injectedRedis === undefined
  // 풀 생성은 파일을 열지 않는다(infra/sqlite.ts) — 첫 질의 때 연다.
  const db = injectedDb ?? createDbPool(env)
  const ownsDb = injectedDb === undefined

  const users = new UserService(redis)
  const rooms = new RoomService(redis)
  const catalog = new GameCatalog()
  // 레지스트리·생명주기·WS 게이트웨이가 **같은** 카탈로그와 **같은** 레지스트리를
  // 봐야 한다. 새로 만들면 REST로 시작한 게임의 모듈 훅이 조용히 돌지 않는다
  // (빌드는 통과한다 — 기본값이 빈 레지스트리다).
  const games = new GameModuleRegistry(catalog)
  const lifecycle = new GameLifecycleService(rooms, catalog, games)

  const registry = new RoomSessionRegistry()
  const broadcaster = new RoomBroadcaster()
  const snapshots = new RealtimeRoomSnapshotService(rooms, registry)
  const heartbeat = new HeartbeatMonitor()
  const closeScheduler = new InMemoryRoomCloseScheduler((error, roomId) =>
    app.log.error({ error, roomId }, '빈 방 폐쇄 실패'),
  )

  return {
    redis,
    ownsRedis,
    db,
    ownsDb,
    users,
    rooms,
    catalog,
    games,
    lifecycle,
    registry,
    broadcaster,
    snapshots,
    heartbeat,
    closeScheduler,
  }
}

/**
 * 상태 엔드포인트 등록 — readiness와 게이지.
 *
 * 왜 분리했나: readiness 실패 로그가 삼항 + 중첩 객체라 `createServer`의 중첩을
 * 한 겹 올렸다. 그리고 이 함수가 지켜야 하는 규칙이 있다 — **주입받은 그 인스턴스**를
 * 검사해야 한다. 새 클라이언트를 만들면 애플리케이션이 쓰는 좌표가 아니라 다른
 * 좌표를 검사하게 되고, 그때 health는 아무것도 증명하지 않는다.
 */
export const registerHealthWiring = async (
  app: FastifyInstance,
  deps: {
    readonly redis: Redis
    readonly db: Pool
    readonly registry: RoomSessionRegistry
    readonly games: GameModuleRegistry
  },
): Promise<void> => {
  await registerHealthRoutes(app, {
    readiness: new ReadinessService([redisReadinessCheck(deps.redis), dbReadinessCheck(deps.db)], {
      onChanged: (result) => logReadiness(app, result),
    }),
    // 게이지는 WS 레지스트리의 인메모리 상태만 본다 — 스크레이프마다 Redis를 때리면
    // 모니터링이 부하 원인이 된다.
    metrics: new RealtimeGameMetrics({ presence: deps.registry, games: deps.games }),
  })
}

const logReadiness = (app: FastifyInstance, result: ReadinessResult): void => {
  if (result.ready) {
    app.log.info('readiness UP — 의존 확인이 전부 응답합니다')
    return
  }
  app.log.error(
    {
      failed: result.failures.map((failure) => ({
        name: failure.name,
        reason: failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
      })),
    },
    'readiness DOWN — /actuator/health가 503을 냅니다',
  )
}
