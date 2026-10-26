import type { FastifyInstance } from 'fastify'
import { GameScoreQueryService, RedisGameScoreQueryStore } from '../game/query/index.js'
import {
  GameReconnectSnapshotService,
  OrphanedRoundStateSweeper,
  type SweepScheduler,
} from '../game/reconnect/index.js'
import type { Redis } from '../infra/memoryRedis.js'
import type { RoomService } from '../room/roomService.js'
import type { WsRoomSnapshot } from '../ws/protocol.js'
import type { RealtimeRoomSnapshotService } from '../ws/snapshot.js'
import type { RoundAssembly } from './rounds.js'

/**
 * 조회(2.9)·재접속 스냅샷(2.8)·고아 스위퍼(2.8)의 조립.
 *
 * 왜 분리했나: `createServer`가 기반 서비스·라운드·조회·라우트·수명주기를 한 함수에
 * 담고 있었다. 이 셋은 **라운드 조립 결과를 받아** 읽기 경로만 만든다 — 조립 방향이
 * 한 방향(라운드 → 조회)이라 따로 읽으면 의존이 분명해진다.
 */
export interface QueryWiringDeps {
  readonly app: FastifyInstance
  readonly redis: Redis
  readonly rooms: RoomService
  readonly snapshots: RealtimeRoomSnapshotService
  readonly rounds: RoundAssembly['rounds']
  readonly sweepScheduler?: SweepScheduler
}

export interface QueryWiring {
  readonly gameQueries: GameScoreQueryService
  readonly reconnectSnapshots: GameReconnectSnapshotService<WsRoomSnapshot>
  readonly sweeper: OrphanedRoundStateSweeper
}

export const assembleQueryWiring = ({
  app,
  redis,
  rooms,
  snapshots,
  rounds,
  sweepScheduler,
}: QueryWiringDeps): QueryWiring => {
  const gameQueries = new GameScoreQueryService(new RedisGameScoreQueryStore(redis))
  const reconnectSnapshots = new GameReconnectSnapshotService<WsRoomSnapshot>({
    realtimeSnapshots: snapshots,
    roundStates: rounds.synchronization,
    deadlines: rounds.timer,
    scoreboards: gameQueries,
  })
  // 스위퍼는 라운드 상태가 Redis에 살기 시작한 지금부터 실전에서 필요하다 —
  // 인메모리 시절에는 재시작에 상태가 함께 사라져 고아가 생기지 않았다.
  const sweeper = new OrphanedRoundStateSweeper(
    { roundStates: rounds.synchronization, timers: rounds.timer, rooms },
    {
      ...(sweepScheduler === undefined ? {} : { scheduler: sweepScheduler }),
      onSwept: (roomId) => app.log.info({ roomId }, '방이 사라진 라운드 상태를 회수했습니다'),
      onError: (error) => app.log.error({ error }, '고아 라운드 상태 스윕 실패'),
    },
  )
  return { gameQueries, reconnectSnapshots, sweeper }
}
