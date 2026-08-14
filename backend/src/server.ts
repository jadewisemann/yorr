import cors from '@fastify/cors'
import fastify, { type FastifyInstance } from 'fastify'
import type { Redis } from 'ioredis'
import { allowedOrigins, type Env } from './config/env.js'
import { GameCatalog } from './game/catalog.js'
import { GameLifecycleService } from './game/lifecycle.js'
import { registerGameRoutes } from './http/routes/games.js'
import { registerHealthRoutes } from './http/routes/health.js'
import { registerRoomRoutes } from './http/routes/rooms.js'
import { createRedisClient } from './infra/redis.js'
import { RoomService } from './room/roomService.js'
import { UserService } from './user/session.js'
import { attachGameSocketGateway, type GameSocketGateway } from './ws/gateway.js'

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
  listen(): Promise<void>
  close(): Promise<void>
}

export const createServer = async (env: Env, options: ServerOptions = {}): Promise<YorrServer> => {
  const redis = options.redis ?? createRedisClient(env)
  const ownsRedis = options.redis === undefined

  const users = new UserService(redis)
  const rooms = new RoomService(redis)
  const catalog = new GameCatalog()
  const lifecycle = new GameLifecycleService(rooms, catalog)

  const app = fastify({ logger: options.logger ?? true })

  await app.register(cors, { origin: allowedOrigins(env) })
  await registerHealthRoutes(app)
  await app.register(
    async (api) => {
      await registerRoomRoutes(api, { users, rooms, catalog, lifecycle })
      await registerGameRoutes(api, { rooms })
    },
    { prefix: API_PREFIX },
  )

  await app.ready()
  const gateway = attachGameSocketGateway(app.server)

  return {
    app,
    gateway,
    listen: async () => {
      await app.listen({ port: env.SERVER_PORT, host: '0.0.0.0' })
    },
    close: async () => {
      await gateway.close()
      await app.close()
      if (ownsRedis) redis.disconnect()
    },
  }
}
