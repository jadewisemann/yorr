import type { GameCompletionService } from '../game/completion/index.js'
import type { GameLifecycleService } from '../game/lifecycle.js'
import type { GameReconnectSnapshotService } from '../game/reconnect/index.js'
import { BotParticipantService } from '../room/botService.js'
import { QuickMatchService } from '../room/quickMatchService.js'
import { SqliteUserProfileStore, UserProfileService } from '../user/profile.js'
import type { WsRoomSnapshot } from '../ws/protocol.js'
import type { BaseServices } from './baseServices.js'
import { registerGameModules } from './games.js'
import type { RoundAssembly } from './rounds.js'

/**
 * 라우트가 쓰는 나머지 서비스 조립 — 프로필·퀵매치·봇 참가자.
 *
 * 왜 분리했나: `createServer`가 "무엇이 무엇을 봐야 하는가"를 135줄에 걸쳐 말하고
 * 있었다. 여기 모인 셋은 **게이트웨이·레지스트리와 같은 인스턴스**를 받아야 하는
 * 것들이라, 그 사실을 이 파일 하나에 모아 두면 배선 함정이 한 자리에서 보인다.
 */
export const assembleRoomServices = (deps: {
  readonly redis: BaseServices['redis']
  readonly db: BaseServices['db']
  readonly users: BaseServices['users']
  readonly rooms: BaseServices['rooms']
  readonly catalog: BaseServices['catalog']
  readonly registry: BaseServices['registry']
  readonly lifecycle: GameLifecycleService
}) => {
  const profiles = new UserProfileService(new SqliteUserProfileStore(deps.db), deps.users)
  // 퀵매치의 자동 시작 조건은 "전원의 WS 소켓이 살아 있는가"다 — WS 게이트웨이와
  // **같은 레지스트리**여야 한다. 새로 만들면 그 조건이 영구히 거짓이 되어 자동
  // 시작이 조용히 안 된다(타입체크는 통과한다).
  const quickMatches = new QuickMatchService({
    redis: deps.redis,
    rooms: deps.rooms,
    users: deps.users,
    catalog: deps.catalog,
    presence: deps.registry,
    games: deps.lifecycle,
  })
  const bots = new BotParticipantService(deps.redis, deps.rooms)
  return { profiles, quickMatches, bots }
}

/**
 * 게임 모듈 등록 — 각 게임 슬라이스가 자기 모듈을 레지스트리에 넣는다.
 *
 * 인스턴스를 새로 만들지 않고 **조립에서 만든 것들**을 그대로 넘긴다. 특히
 * `yachtActions`는 모듈과 봇이 같은 인스턴스를 써야 방송·검증 경로가 갈라지지 않는다.
 */
export const registerGameModuleWiring = (deps: {
  readonly games: BaseServices['games']
  readonly base: BaseServices
  readonly rounds: RoundAssembly['rounds']
  readonly completion: GameCompletionService
  readonly yachtActions: RoundAssembly['yachtActions']
  readonly reconnectSnapshots: GameReconnectSnapshotService<WsRoomSnapshot>
}): void => {
  registerGameModules(deps.games, {
    redis: deps.base.redis,
    registry: deps.base.registry,
    broadcaster: deps.base.broadcaster,
    snapshots: deps.base.snapshots,
    deadlineScheduler: deps.rounds.deadlines,
    completion: deps.completion,
    rooms: deps.base.rooms,
    rounds: deps.rounds.synchronization,
    timers: deps.rounds.timer,
    yachtActions: deps.yachtActions,
    reconnectSnapshots: deps.reconnectSnapshots,
  })
}
