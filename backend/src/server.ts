import cors from '@fastify/cors'
import fastify, { type FastifyInstance } from 'fastify'
import type { Redis } from 'ioredis'
import { allowedOrigins, type Env } from './config/env.js'
import { GameCatalog } from './game/catalog.js'
import { GameLifecycleService } from './game/lifecycle.js'
import { GameModuleRegistry } from './game/module.js'
import { registerGameRoutes } from './http/routes/games.js'
import { registerHealthRoutes } from './http/routes/health.js'
import { registerRoomRoutes } from './http/routes/rooms.js'
import { registerVoiceRoutes } from './http/routes/voice.js'
import { createRedisClient } from './infra/redis.js'
import { BotParticipantService } from './room/botService.js'
import { InMemoryRoomCloseScheduler } from './room/closeScheduler.js'
import { RoomService } from './room/roomService.js'
import { closeUnrecoverableGamesOnStartup } from './room/staleRoomCleaner.js'
import { UserService } from './user/session.js'
import { RoomBroadcaster } from './ws/broadcaster.js'
import { attachGameSocketGateway, type GameSocketGateway } from './ws/gateway.js'
import { GameSocketHandler } from './ws/handler.js'
import { HeartbeatMonitor } from './ws/heartbeat.js'
import { VoiceIceService, voiceIceOptions } from './ws/iceServers.js'
import { RoomSessionRegistry } from './ws/registry.js'
import { RealtimeRoomSnapshotService } from './ws/snapshot.js'

/** REST base. WebSocket은 `/ws/v1/game`(gateway.ts) — 둘 다 계약이다. */
const API_PREFIX = '/api/v1'

export interface ServerOptions {
  /** 통합 테스트가 자기 Redis를 넘긴다. 없으면 env로 새로 만들고 종료 시 함께 닫는다. */
  readonly redis?: Redis
  readonly logger?: boolean
}

export interface YorrServer {
  app: FastifyInstance
  gateway: GameSocketGateway
  registry: RoomSessionRegistry
  listen(): Promise<void>
  close(): Promise<void>
}

export const createServer = async (env: Env, options: ServerOptions = {}): Promise<YorrServer> => {
  const redis = options.redis ?? createRedisClient(env)
  const ownsRedis = options.redis === undefined

  const users = new UserService(redis)
  const rooms = new RoomService(redis)
  const catalog = new GameCatalog()
  // 레지스트리·생명주기·WS 게이트웨이가 **같은** 카탈로그와 **같은** 레지스트리를
  // 봐야 한다. 새로 만들면 REST로 시작한 게임의 모듈 훅이 조용히 돌지 않는다
  // (빌드는 통과한다 — 기본값이 빈 레지스트리다).
  const games = new GameModuleRegistry(catalog)
  const lifecycle = new GameLifecycleService(rooms, catalog, games)

  const app = fastify({ logger: options.logger ?? true })

  const registry = new RoomSessionRegistry()
  const broadcaster = new RoomBroadcaster()
  const snapshots = new RealtimeRoomSnapshotService(rooms, registry)
  const heartbeat = new HeartbeatMonitor()
  const closeScheduler = new InMemoryRoomCloseScheduler((error, roomId) =>
    app.log.error({ error, roomId }, '빈 방 폐쇄 실패'),
  )

  await app.register(cors, { origin: allowedOrigins(env) })
  await registerHealthRoutes(app)
  await app.register(
    async (api) => {
      await registerRoomRoutes(api, {
        users,
        rooms,
        catalog,
        lifecycle,
        // 봇 API는 WS 게이트웨이와 **같은** 브로드캐스터·스냅샷 인스턴스를 받아야
        // state.sync가 실제 소켓으로 나간다(rooms.ts의 RoomRouteDependencies 참고).
        bots: new BotParticipantService(redis, rooms),
        broadcaster,
        snapshots,
      })
      await registerGameRoutes(api, { rooms })
      await registerVoiceRoutes(api, { ice: new VoiceIceService(voiceIceOptions(env)) })
    },
    { prefix: API_PREFIX },
  )

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

  return {
    app,
    gateway,
    registry,
    listen: async () => {
      // 부팅 시 정리: 마감 타이머가 하나도 없는 지금 PLAYING인 방은 이어갈 수 없다.
      const closed = await closeUnrecoverableGamesOnStartup(rooms)
      if (closed > 0) app.log.info({ closed }, '재시작으로 이어갈 수 없는 진행 중 방을 닫았습니다')
      await app.listen({ port: env.SERVER_PORT, host: '0.0.0.0' })
    },
    close: async () => {
      heartbeat.stop()
      closeScheduler.stop()
      await gateway.close()
      await app.close()
      if (ownsRedis) redis.disconnect()
    },
  }
}
