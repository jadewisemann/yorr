import fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { GameCatalog } from '../../../game/catalog.js'
import { RealtimeGameMetrics } from '../../../monitoring/index.js'
import { RoomSessionRegistry } from '../../../ws/registry.js'
import { type ClientSocket, SOCKET_OPEN } from '../../../ws/socket.js'
import { registerHealthRoutes } from '../health.js'

/**
 * 액추에이터 라우트만 검증하므로 `createServer`(Redis·MySQL 배선)를 쓰지 않는다 —
 * 이 표면의 계약은 "경로·본문·Content-Type"이고, 값의 계약은 monitoring 테스트가 본다.
 */
const socket = (): ClientSocket => ({ readyState: SOCKET_OPEN, send: () => {}, close: () => {} })

let app: FastifyInstance | null = null

const startApp = async (metrics?: RealtimeGameMetrics): Promise<FastifyInstance> => {
  const instance = fastify({ logger: false })
  await registerHealthRoutes(instance, metrics ? { metrics } : {})
  await instance.ready()
  app = instance
  return instance
}

afterEach(async () => {
  await app?.close()
  app = null
})

describe('/actuator', () => {
  it('헬스는 그대로 {"status":"UP"}이다', async () => {
    const instance = await startApp()

    const response = await instance.inject({ method: 'GET', url: '/actuator/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'UP' })
  })

  it('프로메테우스 노출은 텍스트 형식으로 두 게이지를 낸다', async () => {
    const registry = new RoomSessionRegistry()
    registry.registerGame('ROOM1', 'YACHT_DICE')
    registry.join('ROOM1', socket(), 'player-1', '호스트')
    registry.join('ROOM1', socket(), 'player-2', '참가자')
    registry.markPhase('ROOM1', 'playing')
    const instance = await startApp(
      new RealtimeGameMetrics({ presence: registry, games: new GameCatalog() }),
    )

    const response = await instance.inject({ method: 'GET', url: '/actuator/prometheus' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/plain; version=0.0.4; charset=utf-8')
    expect(response.body).toContain('# TYPE yorr_rooms_active gauge')
    expect(response.body).toContain('yorr_rooms_active 1')
    expect(response.body).toContain('yorr_game_participants_active{game="YACHT_DICE"} 2')
  })

  /** 스크레이프가 조용히 성공하는 것보다 실패하는 편이 낫다 — 배선 누락은 이 저장소의 상습 실패다. */
  it('수집기가 배선되지 않으면 404가 아니라 503이다', async () => {
    const instance = await startApp()

    const response = await instance.inject({ method: 'GET', url: '/actuator/prometheus' })

    expect(response.statusCode).toBe(503)
    expect(response.body).toContain('metrics_unavailable')
  })

  it('health·prometheus 외의 액추에이터 엔드포인트는 노출하지 않는다', async () => {
    const instance = await startApp(
      new RealtimeGameMetrics({
        presence: new RoomSessionRegistry(),
        games: new GameCatalog(),
      }),
    )

    for (const path of [
      '/actuator',
      '/actuator/',
      '/actuator/metrics',
      '/actuator/metrics/yorr.rooms.active',
      '/actuator/info',
      '/actuator/env',
      '/actuator/beans',
      '/actuator/loggers',
      '/actuator/heapdump',
      '/actuator/health/liveness',
    ]) {
      const response = await instance.inject({ method: 'GET', url: path })
      expect(response.statusCode, path).toBe(404)
    }
  })
})
