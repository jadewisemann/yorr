import cors from '@fastify/cors'
import fastify, { type FastifyInstance } from 'fastify'
import { allowedOrigins, type Env } from './config/env.js'
import { registerHealthRoutes } from './http/routes/health.js'
import { attachGameSocketGateway, type GameSocketGateway } from './ws/gateway.js'

export interface YorrServer {
  app: FastifyInstance
  gateway: GameSocketGateway
  listen(): Promise<void>
  close(): Promise<void>
}

export const createServer = async (env: Env): Promise<YorrServer> => {
  const app = fastify({ logger: true })

  await app.register(cors, { origin: allowedOrigins(env) })
  await registerHealthRoutes(app)

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
    },
  }
}
