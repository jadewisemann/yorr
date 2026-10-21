import cors from '@fastify/cors'
import fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import { createBaseServices, registerHealthWiring } from './composition/baseServices.js'
import { createServerLifecycle } from './composition/lifecycle.js'
import { assembleQueryWiring } from './composition/queries.js'
import { assembleRoomServices, registerGameModuleWiring } from './composition/roomServices.js'
import { assembleRoundWiring, type RoundWiring } from './composition/rounds.js'
import { allowedOrigins, type Env } from './config/env.js'
import type { GameCompletionService } from './game/completion/index.js'
import type { GameModuleRegistry } from './game/module.js'
import type { WeeklyRankingService } from './game/ranking/index.js'
import type { OrphanedRoundStateSweeper, SweepScheduler } from './game/reconnect/index.js'
import type { YachtBotPolicy } from './game/yacht/index.js'
import { registerApiRoutes } from './http/apiRoutes.js'
import type { Redis } from './infra/memoryRedis.js'
import type { Pool } from './infra/sqlite.js'
import type { RoomBroadcaster } from './ws/broadcaster.js'
import { attachGameSocketGateway, type GameSocketGateway } from './ws/gateway.js'
import { GameSocketHandler } from './ws/handler.js'
import type { RoomSessionRegistry } from './ws/registry.js'

export interface ServerOptions {
  /** 통합 테스트가 자기 Redis를 넘긴다. 없으면 env로 새로 만들고 종료 시 함께 닫는다. */
  readonly redis?: Redis
  /**
   * DB 풀(SQLite). Redis와 같은 규약이다 — 주입하면 **주입한 쪽이 닫는다**.
   * `main.ts`는 자기가 만든 풀을 넘기고, 통합 테스트는 인메모리 풀을 넘긴다.
   */
  readonly db?: Pool
  /**
   * Fastify 로거 설정. 운영은 생략한다(`true`). 블랙박스 하네스는 `{ stream }`을 넘겨
   * 로그를 모은다 — "핸들러 밖으로 새어 나온 예외가 0건"을 단정하는 유일한 창이다.
   */
  readonly logger?: FastifyServerOptions['logger']
  /**
   * 고아 라운드 상태 스윕(2.8)의 주기 실행 시임 — **테스트 전용**이다. 운영은
   * 생략해 실제 5분 타이머를 쓴다. 배선 회귀 테스트가 5분을 기다리지 않고
   * "listen()이 실제로 주기를 걸었는가"를 확인하는 유일한 창이다.
   */
  readonly sweepScheduler?: SweepScheduler
}

export interface YorrServer {
  app: FastifyInstance
  gateway: GameSocketGateway
  registry: RoomSessionRegistry
  /** WS 게이트웨이·봇 REST·라운드 타이머가 공유하는 **그** 인스턴스. */
  broadcaster: RoomBroadcaster
  rounds: RoundWiring
  /**
   * 세 게임 모듈(3.1 야추·3.3 듀얼·3.4 탁구)이 등록된 **그** 레지스트리.
   * WS 게이트웨이와 `GameLifecycleService`가 같은 것을 본다.
   */
  games: GameModuleRegistry
  /**
   * 게임 종료 단일 진입점(2.7). 라운드 타이머·듀얼·탁구가 **이 인스턴스**를 받는다 —
   * 스텁이 남아 있으면 게임이 FINISHED가 되어도 `game.over`가 나가지 않는다.
   */
  completion: GameCompletionService
  /** 고아 라운드 상태 스윕(2.8). `listen()`이 `start()`, `close()`가 `stop()`을 부른다. */
  sweeper: OrphanedRoundStateSweeper
  /** 주간 랭킹(4.5). 상위 목록 캐시는 4.4의 보관 서비스가 evict하는 **그** 인스턴스다. */
  rankings: WeeklyRankingService
  /**
   * 봇 탐색 정책. 운영은 `CooperativeYachtBotPolicy`로 감싼 인스턴스다 — 배선 회귀
   * 테스트가 큐 래핑이 빠졌는지 확인하는 창이다.
   */
  botPolicy: YachtBotPolicy
  listen(): Promise<void>
  close(): Promise<void>
}

export const createServer = async (env: Env, options: ServerOptions = {}): Promise<YorrServer> => {
  const app = fastify({ logger: options.logger ?? true })
  const base = createBaseServices({
    app,
    env,
    ...(options.redis === undefined ? {} : { redis: options.redis }),
    ...(options.db === undefined ? {} : { db: options.db }),
  })
  const { redis, ownsRedis, db, ownsDb, users, rooms, catalog } = base
  const { games, lifecycle, registry, broadcaster, snapshots, heartbeat, closeScheduler } = base

  const roundAssembly = assembleRoundWiring({
    app,
    broadcaster,
    db,
    redis,
    registry,
    rooms,
    snapshots,
  })
  const { rounds, completion, rankings, botPolicy, matchArchive } = roundAssembly

  const { gameQueries, reconnectSnapshots, sweeper } = assembleQueryWiring({
    app,
    redis,
    rooms,
    snapshots,
    rounds,
    ...(options.sweepScheduler === undefined ? {} : { sweepScheduler: options.sweepScheduler }),
  })

  registerGameModuleWiring({
    games,
    base,
    rounds,
    completion,
    yachtActions: roundAssembly.yachtActions,
    reconnectSnapshots,
  })

  const { profiles, quickMatches, bots } = assembleRoomServices({
    redis,
    db,
    users,
    rooms,
    catalog,
    registry,
    lifecycle,
  })

  await app.register(cors, { origin: allowedOrigins(env) })
  // 게이지 수집은 WS 레지스트리의 인메모리 상태만 본다(스크레이프마다 Redis를
  // 때리면 모니터링이 부하 원인이 된다). **위에서 만든 그** 레지스트리·모듈
  // 레지스트리여야 한다 — 새로 만들면 게이지가 영구히 0인데 타입도 테스트도 통과한다.
  await registerHealthWiring(app, { redis, db, registry, games })

  await registerApiRoutes({
    app,
    env,
    redis,
    db,
    users,
    rooms,
    catalog,
    lifecycle,
    queries: gameQueries,
    profiles,
    quickMatches,
    bots,
    broadcaster,
    snapshots,
    rankings,
    matchArchive,
  })

  await app.ready()
  const gateway = attachGameSocketGateway(
    app.server,
    new GameSocketHandler({
      registry,
      broadcaster,
      snapshots,
      heartbeat,
      users,
      rooms,
      closeScheduler,
      games,
      logger: app.log,
    }),
    { logger: app.log, allowedOrigins: allowedOrigins(env) },
  )

  const serverLifecycle = createServerLifecycle({
    app,
    env,
    redis,
    db,
    ownsRedis,
    ownsDb,
    rooms,
    games,
    completion,
    gateway,
    heartbeat,
    closeScheduler,
    sweeper,
    stopRoundWork: () => {
      roundAssembly.stopDeadlines()
      roundAssembly.stopBots()
    },
  })

  return {
    app,
    gateway,
    registry,
    broadcaster,
    rounds,
    games,
    completion,
    sweeper,
    rankings,
    botPolicy,
    ...serverLifecycle,
  }
}
