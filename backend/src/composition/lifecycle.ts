import type { FastifyInstance } from 'fastify'
import type { Env } from '../config/env.js'
import type { GameCompletionService } from '../game/completion/index.js'
import type { GameModuleRegistry } from '../game/module.js'
import type { OrphanedRoundStateSweeper } from '../game/reconnect/index.js'
import { resumeGamesOnStartup } from '../game/startupResume.js'
import type { Redis } from '../infra/memoryRedis.js'
import type { Pool } from '../infra/sqlite.js'
import { closeDbPool } from '../infra/sqlite.js'
import type { InMemoryRoomCloseScheduler } from '../room/closeScheduler.js'
import type { RoomService } from '../room/roomService.js'
import type { GameSocketGateway } from '../ws/gateway.js'
import type { HeartbeatMonitor } from '../ws/heartbeat.js'

/**
 * 서버 수명주기 — `listen`/`close`를 `server.ts`의 조립에서 떼어낸 것.
 *
 * 왜 분리했나: `createServer`가 조립·라우트·수명주기를 한 함수에 담아 200줄이었다.
 * 수명주기는 "무엇을 어떤 순서로 켜고 끄는가"라서, 조립과 섞이면 **순서가 계약**이라는
 * 사실이 묻힌다(부팅 재무장이 `listen`보다 먼저여야 하는 이유 등).
 */
export interface ServerLifecycleDependencies {
  readonly app: FastifyInstance
  readonly env: Env
  readonly redis: Redis
  readonly db: Pool
  readonly ownsRedis: boolean
  readonly ownsDb: boolean
  readonly rooms: RoomService
  readonly games: GameModuleRegistry
  readonly completion: GameCompletionService
  readonly gateway: GameSocketGateway
  readonly heartbeat: HeartbeatMonitor
  /** `stop()`이 인터페이스가 아니라 어댑터에 있다 — 종료 시 타이머를 걷어야 한다. */
  readonly closeScheduler: InMemoryRoomCloseScheduler
  readonly sweeper: OrphanedRoundStateSweeper
  readonly stopRoundWork: () => void
}

export interface ServerLifecycle {
  listen(): Promise<void>
  close(): Promise<void>
}

/**
 * 진행 중이던 판을 되살린다(PR 6). **`app.listen()`보다 먼저**여야 한다 — 요청을 받기
 * 시작한 뒤에 되살리면 그 사이 도착한 재접속이 아직 비어 있는 마감을 보고 실패한다.
 *
 * 예전에는 이 자리가 `closeUnrecoverableGamesOnStartup`이었다. 마감 시각이 프로세스
 * 인메모리라 진행 중이던 방을 **전부** 닫는 것이 유일한 대책이었다. 지금은 저장된
 * 마감으로 이어가고, 이어갈 수 없는 방만 닫는다.
 */
const rearmGames = async (deps: ServerLifecycleDependencies): Promise<void> => {
  const report = await resumeGamesOnStartup(
    { rooms: deps.rooms, games: deps.games },
    {
      onResumed: (roomCode, gameCode) =>
        deps.app.log.info({ roomCode, gameCode }, '진행 중이던 판을 이어갑니다'),
      onClosed: (roomCode, reason) =>
        deps.app.log.warn({ roomCode, reason }, '이어갈 수 없는 진행 중 방을 닫았습니다'),
    },
  )
  if (report.resumed > 0 || report.closed > 0) {
    deps.app.log.info(report, '부팅 재무장을 마쳤습니다')
  }
}

export const createServerLifecycle = (deps: ServerLifecycleDependencies): ServerLifecycle => {
  const { app, env, redis, db, sweeper } = deps

  return {
    async listen() {
      // 부팅 재무장이 `listen`보다 먼저다 — `rearmGames` 주석 참고.
      await rearmGames(deps)
      // 방이 사라진 뒤 남은 라운드 상태 키를 5분마다 회수한다(2.8). 상태가 Redis에
      // 살기 시작한 뒤로는 실제로 고아가 생긴다 — 인메모리였을 때는 재시작이 청소했다.
      sweeper.start()
      await app.listen({ port: env.SERVER_PORT, host: '0.0.0.0' })
    },

    async close() {
      deps.heartbeat.stop()
      deps.closeScheduler.stop()
      // 스윕 주기를 먼저 끊는다 — 남아 있으면 닫힌 Redis로 SCAN을 던진다.
      sweeper.stop()
      // 걸려 있는 라운드 마감 타이머를 전부 끊는다. 안 하면 unref된 타이머가 남아
      // 이미 닫힌 Redis로 마감 처리를 시도한다(테스트에서는 스위트 간 누수가 된다).
      deps.stopRoundWork()
      await deps.gateway.close()
      await app.close()
      if (deps.ownsRedis) redis.disconnect()
      if (deps.ownsDb) await closeDbPool(db)
    },
  }
}
