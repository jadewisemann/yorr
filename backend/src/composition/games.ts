import type { GameCompletionService } from '../game/completion/index.js'
import {
  DavinciGameModule,
  DavinciGameService,
  RedisDavinciScoreboard,
  RedisDavinciStateStore,
  registryAudience,
} from '../game/davinci/index.js'
import {
  DuelGameModule,
  DuelGameService,
  RedisDuelScoreboard,
  RedisDuelStateStore,
} from '../game/duel/index.js'
import type { GameModuleRegistry } from '../game/module.js'
import {
  PingPongGameModule,
  PingPongGameService,
  RedisPingPongStateStore,
  redisPingPongScoreWriter,
} from '../game/pingpong/index.js'
import type {
  RoundDeadlineScheduler,
  RoundSynchronizationService,
  RoundTimerService,
} from '../game/round/index.js'
import type { YachtTurnActionService } from '../game/yacht/index.js'
import { YachtDiceGameModule } from '../game/yacht/index.js'
import type { Redis } from '../infra/memoryRedis.js'
import type { RoomService } from '../room/roomService.js'
import type { RoomBroadcaster } from '../ws/broadcaster.js'
import type { WsRoomSnapshot } from '../ws/protocol.js'
import type { RoomSessionRegistry } from '../ws/registry.js'
import type { RealtimeRoomSnapshotService } from '../ws/snapshot.js'
import type { ClientSocket } from '../ws/socket.js'

/**
 * 게임 모듈 3개(3.1 야추·3.3 듀얼·3.4 다빈치·3.4 탁구)의 등록.
 *
 * 왜 `server.ts`에서 뺐나: 여기서 중요한 것은 **어느 인스턴스를 넘기는가**다. 브로드캐스터·
 * 레지스트리·스냅샷·마감 스케줄러·종료 서비스가 위에서 만든 그 인스턴스가 아니면 방송이
 * 허공으로 나가고 레지스트리 phase가 갈라지는데, 타입도 테스트도 통과한다. 그 계약을
 * 한 파일에 모아 두면 "새 모듈을 등록할 때 무엇을 넘겨야 하는가"가 한눈에 보인다.
 */

export interface GameModuleDeps {
  readonly redis: Redis
  readonly registry: RoomSessionRegistry
  readonly broadcaster: RoomBroadcaster
  readonly snapshots: RealtimeRoomSnapshotService
  readonly deadlineScheduler: RoundDeadlineScheduler
  readonly completion: GameCompletionService
  readonly rooms: RoomService
  readonly rounds: RoundSynchronizationService
  readonly timers: RoundTimerService
  readonly yachtActions: YachtTurnActionService
  readonly reconnectSnapshots: ConstructorParameters<
    typeof YachtDiceGameModule
  >[0]['reconnectSnapshots']
}

export function registerGameModules(games: GameModuleRegistry, deps: GameModuleDeps) {
  const {
    redis,
    registry,
    broadcaster,
    snapshots,
    deadlineScheduler,
    completion,
    rooms,
    rounds,
    timers,
    yachtActions,
    reconnectSnapshots,
  } = deps

  // 브로드캐스터·레지스트리·스냅샷·마감 스케줄러·종료 서비스는 **전부 위에서 만든
  // 그 인스턴스**다. 새로 만들면 방송이 허공으로 나가고 레지스트리 phase가 갈라지는데,
  // 타입도 테스트도 통과한다.
  games.register(
    new YachtDiceGameModule({
      rounds,
      timers,
      actions: yachtActions,
      seats: registry,
      realtimeSnapshots: snapshots,
      reconnectSnapshots,
      broadcaster,
    }),
  )
  games.register(
    new DuelGameModule(
      new DuelGameService<WsRoomSnapshot>({
        states: new RedisDuelStateStore(redis),
        scheduler: deadlineScheduler,
        broadcaster,
        realtimeSnapshots: snapshots,
        presence: registry,
        completion,
        scoreboard: new RedisDuelScoreboard(redis),
      }),
      registry,
    ),
  )
  games.register(
    new DavinciGameModule(
      new DavinciGameService<WsRoomSnapshot, ClientSocket>({
        states: new RedisDavinciStateStore(redis),
        scheduler: deadlineScheduler,
        // 좌석마다 감춘 숫자가 달라 방송기 대신 유니캐스트 어댑터를 쓴다
        // (game/davinci/davinciPorts.ts의 `DavinciAudience` 주석).
        audience: registryAudience(registry),
        realtimeSnapshots: snapshots,
        presence: registry,
        completion,
        scoreboard: new RedisDavinciScoreboard(redis),
      }),
      registry,
    ),
  )
  games.register(
    new PingPongGameModule(
      new PingPongGameService<WsRoomSnapshot>({
        states: new RedisPingPongStateStore(redis),
        scheduler: deadlineScheduler,
        broadcaster,
        snapshots,
        presence: registry,
        completion,
        scoreWriter: redisPingPongScoreWriter(redis),
        rooms,
      }),
      registry,
    ),
  )
}
