import { Redis } from 'ioredis'
import type { Env } from '../config/env.js'

// lazyConnect — 서버 기동은 Redis 없이도 성공해야 한다.
// 실제 연결은 방·세션 기능이 처음 명령을 보낼 때 이루어진다.
export const createRedisClient = (env: Env): Redis =>
  new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
    lazyConnect: true,
  })
