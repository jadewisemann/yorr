import type { FastifyInstance } from 'fastify'
import type { Redis } from '../infra/memoryRedis.js'
import type { Pool } from '../infra/sqlite.js'
import type { RoomService } from '../room/roomService.js'
import type { RoomBroadcaster } from '../ws/broadcaster.js'
import type { RoomSessionRegistry } from '../ws/registry.js'
import type { RealtimeRoomSnapshotService } from '../ws/snapshot.js'
import type { BaseServices } from './baseServices.js'
import { assembleQueryWiring } from './queries.js'
import { assembleRoomServices, registerGameModuleWiring } from './roomServices.js'
import { assembleRoundWiring, type RoundAssembly } from './rounds.js'

export interface Runtime {
  readonly roundAssembly: RoundAssembly
  readonly queries: ReturnType<typeof assembleQueryWiring>
  readonly roomServices: ReturnType<typeof assembleRoomServices>
  readonly rounds: RoundAssembly['rounds']
}

export interface RuntimeDeps {
  readonly app: FastifyInstance
  readonly base: BaseServices
  readonly redis: Redis
  readonly db: Pool
  readonly rooms: RoomService
  readonly registry: RoomSessionRegistry
  readonly broadcaster: RoomBroadcaster
  readonly snapshots: RealtimeRoomSnapshotService
  readonly sweepScheduler?: Parameters<typeof assembleQueryWiring>[0]['sweepScheduler']
}

/**
 * 라운드 → 조회 → 게임 모듈 → 방 서비스 순서의 조립. `createServer`가 이 순서를
 * 한 함수에 담으면 선언만으로 100줄이 넘어 "무엇이 무엇을 봐야 하는가"가 묻힌다.
 *
 * 순서가 곧 의존 방향이다 — 조회는 라운드 결과를 받고, 게임 모듈 등록은 둘 다 받는다.
 */
export function assembleRuntime(deps: RuntimeDeps): Runtime {
  const roundAssembly = assembleRoundWiring({
    app: deps.app,
    broadcaster: deps.broadcaster,
    db: deps.db,
    redis: deps.redis,
    registry: deps.registry,
    rooms: deps.rooms,
    snapshots: deps.snapshots,
  })
  const { rounds, completion } = roundAssembly

  const queries = assembleQueryWiring({
    app: deps.app,
    redis: deps.redis,
    rooms: deps.rooms,
    snapshots: deps.snapshots,
    rounds,
    ...(deps.sweepScheduler === undefined ? {} : { sweepScheduler: deps.sweepScheduler }),
  })

  registerGameModuleWiring({
    games: deps.base.games,
    base: deps.base,
    rounds,
    completion,
    yachtActions: roundAssembly.yachtActions,
    reconnectSnapshots: queries.reconnectSnapshots,
  })

  const roomServices = assembleRoomServices({
    redis: deps.redis,
    db: deps.db,
    users: deps.base.users,
    rooms: deps.rooms,
    catalog: deps.base.catalog,
    registry: deps.registry,
    lifecycle: deps.base.lifecycle,
  })

  return { queries, roomServices, roundAssembly, rounds }
}
