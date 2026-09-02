import fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { GameCatalog } from '../../../game/catalog.js'
import {
  type ReadinessPort,
  ReadinessService,
  RealtimeGameMetrics,
} from '../../../monitoring/index.js'
import { RoomSessionRegistry } from '../../../ws/registry.js'
import { type ClientSocket, SOCKET_OPEN } from '../../../ws/socket.js'
import { type ActuatorRouteDependencies, registerHealthRoutes } from '../health.js'

/**
 * 액추에이터 라우트만 검증하므로 `createServer`(Redis·MySQL 배선)를 쓰지 않는다 —
 * 이 표면의 계약은 "경로·본문·Content-Type"이고, 값의 계약은 monitoring 테스트가 본다.
 */
const socket = (): ClientSocket => ({ readyState: SOCKET_OPEN, send: () => {}, close: () => {} })

/** 준비됐다고만 답하는 판정기. 판정 로직 자체는 `monitoring/__tests__/readiness.test.ts`가 본다. */
const readyProbe = (): ReadinessPort => new ReadinessService([])

let app: FastifyInstance | null = null

const startApp = async (deps: ActuatorRouteDependencies = {}): Promise<FastifyInstance> => {
  const instance = fastify({ logger: false })
  await registerHealthRoutes(instance, deps)
  await instance.ready()
  app = instance
  return instance
}

afterEach(async () => {
  await app?.close()
  app = null
})

/** 준비 상태 응답 한 통. 배포 게이트가 읽는 유일한 표면이다. */
const health = (instance: FastifyInstance) =>
  instance.inject({ method: 'GET', url: '/actuator/health' })

/** 죽었다고 답하는 의존 하나. 이름과 오류 문구는 검사마다 다르다. */
const failingProbe = (name: string, message: string) =>
  new ReadinessService([
    {
      name,
      run: () => {
        throw new Error(message)
      },
    },
  ])

describe('/actuator', () => {
  it('의존 확인이 전부 통과하면 200 {"status":"UP"}이다', async () => {
    const instance = await startApp({ readiness: readyProbe() })

    const response = await health(instance)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'UP' })
  })

  /**
   * 이 한 줄이 배포 게이트의 전부다. 예전 구현은 상수 `UP`이었고, 그때
   * `up -d --wait`는 Redis·MySQL이 죽은 컨테이너를 성공으로 읽었다(PLAN.md 버그 B).
   */
  it('의존 하나라도 실패하면 503 {"status":"DOWN"}이다', async () => {
    const instance = await startApp({ readiness: failingProbe('redis', '죽었다') })

    const response = await health(instance)

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'DOWN' })
  })

  /** 어느 의존이 죽었는지는 본문에 싣지 않는다 — 인증 없이 공개되는 표면이다. */
  it('DOWN 본문에 의존 이름이 새지 않는다', async () => {
    const instance = await startApp({
      readiness: failingProbe('mysql', 'ECONNREFUSED 10.0.0.5:3306'),
    })

    const response = await health(instance)

    expect(response.body).not.toContain('mysql')
    expect(response.body).not.toContain('10.0.0.5')
  })

  /**
   * 배선 누락은 초록이 아니라 실패여야 한다(prometheus 라우트와 같은 규약). 이 방향이면
   * 컨테이너가 healthy가 되지 못해 `up -d --wait`가 배포를 거절한다.
   */
  it('판정기가 배선되지 않으면 200이 아니라 503이다', async () => {
    const instance = await startApp()

    const response = await health(instance)

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'DOWN' })
  })

  it('프로메테우스 노출은 텍스트 형식으로 두 게이지를 낸다', async () => {
    const registry = new RoomSessionRegistry()
    registry.registerGame('ROOM1', 'YACHT_DICE')
    registry.join('ROOM1', socket(), 'player-1', '호스트')
    registry.join('ROOM1', socket(), 'player-2', '참가자')
    registry.markPhase('ROOM1', 'playing')
    const instance = await startApp({
      metrics: new RealtimeGameMetrics({ presence: registry, games: new GameCatalog() }),
    })

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
    const instance = await startApp({
      readiness: readyProbe(),
      metrics: new RealtimeGameMetrics({
        presence: new RoomSessionRegistry(),
        games: new GameCatalog(),
      }),
    })

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
