import type { FastifyInstance } from 'fastify'
import { GameCompletionService, RedisGameCompletionStore } from '../game/completion/index.js'
import { MatchArchiveService, SqliteMatchArchiveStore } from '../game/match/index.js'
import {
  CachingWeeklyRankingRepository,
  SqliteWeeklyRankingStore,
  WeeklyRankingService,
} from '../game/ranking/index.js'
import {
  InMemoryRoundDeadlineScheduler,
  type RoundDeadlineScheduler,
  type RoundDeadlineStore,
  type RoundStateStore,
  type RoundSubmissionResult,
  RoundSynchronizationService,
  RoundTimeoutResolver,
  RoundTimerService,
} from '../game/round/index.js'
import {
  RedisScoreBoardStore,
  ScoreConfirmationService,
  ScoreRoundSubmissionService,
} from '../game/score/index.js'
import {
  type BotTurnOrchestrator,
  RedisRoundDeadlineStore,
  RedisYachtDiceStateStore,
  type YachtBotPolicy,
  YachtTurnActionService,
} from '../game/yacht/index.js'
import type { Redis } from '../infra/memoryRedis.js'
import type { Pool } from '../infra/sqlite.js'
import type { RoomService } from '../room/roomService.js'
import type { RoomBroadcaster } from '../ws/broadcaster.js'
import type { RoomSessionRegistry } from '../ws/registry.js'
import type { RealtimeRoomSnapshotService } from '../ws/snapshot.js'
import { assembleBotWiring } from './botWiring.js'

/**
 * 라운드 진행(2.5)·점수 확정(2.6)·랭킹(4.5)·전적(4.4)·게임 종료(2.7)·야추 봇(3.2)의 조립.
 *
 * 왜 `server.ts`에서 뺐나: 이 블록은 **조립 순서가 곧 의존 방향**이라는 주석 덩어리와 함께
 * 100줄이 넘는다. HTTP 라우트 등록·게이트웨이 부착과 섞여 있으면 "무엇이 무엇을 봐야 하는가"를
 * 한 화면에서 놓치기 쉽다. 여기서는 순서를 한 방향으로만 읽히게 두고, `server.ts`는
 * "무엇을 조립했는가"만 받는다.
 */

export interface RoundWiring {
  /**
   * **운영은 Redis 어댑터(3.1)다.** `InMemoryRoundStateStore`는 2.4가 남긴 테스트
   * 시드이며, 여기 두면 서버 재시작마다 진행 중 게임 상태가 사라진다(타입은 맞아서
   * 아무 테스트도 깨지지 않는다).
   */
  readonly states: RoundStateStore
  readonly synchronization: RoundSynchronizationService
  readonly scores: ScoreConfirmationService
  readonly submissions: ScoreRoundSubmissionService<RoundSubmissionResult>
  /** `close()`가 `stop()`을 부른다 — 남은 마감 타이머가 이미 닫힌 Redis를 두드리지 않게. */
  readonly deadlines: RoundDeadlineScheduler
  /**
   * 마감 시각의 영속 사본(PR 6). **운영은 Redis 어댑터다** —
   * `InMemoryRoundDeadlineStore`를 여기 두면 재시작마다 진행 중 게임이 사라지는
   * 예전 동작으로 조용히 돌아간다(타입은 맞고 테스트도 통과한다).
   */
  readonly deadlineStore: RoundDeadlineStore
  readonly timer: RoundTimerService
}

export interface RoundAssemblyDeps {
  readonly app: FastifyInstance
  readonly broadcaster: RoomBroadcaster
  readonly db: Pool
  readonly redis: Redis
  readonly registry: RoomSessionRegistry
  readonly rooms: RoomService
  readonly snapshots: RealtimeRoomSnapshotService
}

export interface RoundAssembly {
  readonly rounds: RoundWiring
  readonly completion: GameCompletionService
  readonly rankings: WeeklyRankingService
  readonly botPolicy: YachtBotPolicy
  /** 야추 모듈 등록이 같은 인스턴스를 받아야 한다(방송·검증 경로가 갈라지지 않게). */
  readonly yachtActions: YachtTurnActionService
  /** AI 탁구 결과(4.6)가 **같은** 보관 서비스를 받아야 랭킹 캐시 evict가 유효하다. */
  readonly matchArchive: MatchArchiveService
  /** `close()`가 부른다 — 걸린 마감 타이머를 전부 끊는다(닫힌 Redis를 두드리지 않게). */
  readonly stopDeadlines: () => void
  /** `close()`가 부른다 — 봇 턴 오케스트레이터를 멈춘다. */
  readonly stopBots: () => void
}

export function assembleRoundWiring({
  app,
  broadcaster,
  db,
  redis,
  registry,
  rooms,
  snapshots,
}: RoundAssemblyDeps): RoundAssembly {
  const roundCore = assembleRoundCore({ app, broadcaster, redis, rooms })
  const {
    roundStates,
    roundSync,
    scores,
    scoreSubmissions,
    deadlineScheduler,
    deadlineStore,
    timeoutResolver,
  } = roundCore

  const { rankings, matchArchive } = assembleRankingWiring({ app, db })

  const completion = assembleCompletionWiring({
    app,
    broadcaster,
    matchArchive,
    redis,
    registry,
    rooms,
    snapshots,
    deadlineScheduler,
  })

  // 봇 오케스트레이터(3.2)와 타이머는 순환한다(봇 → 행동 서비스 → 타이머 → 봇).
  // 순환은 늦은 바인딩으로 끊는다 — 타이머가 먼저 만들어지고, 그 콜백이 나중에 채워진다.
  let yachtBots: BotTurnOrchestrator | null = null
  const roundTimer = new RoundTimerService(
    {
      timeoutResolver,
      deadlineScheduler,
      deadlineStore,
      broadcaster,
      gameCompletion: completion,
      synchronizationService: roundSync,
      presence: registry,
      roomService: rooms,
    },
    {
      onWarning: (roomId, reason) => app.log.warn({ roomId, reason }, '라운드 진행 중단'),
      onRoundStarted: (event) => yachtBots?.onRoundStarted(event),
    },
  )

  // 봇과 사람이 **같은** 행동 서비스를 지나야 한다(3.1이 그 경계로 만들었다) —
  // 봇만 별도 인스턴스를 쓰면 방송·검증 경로가 갈라진다.
  const yachtActions = new YachtTurnActionService({
    rounds: roundSync,
    timers: roundTimer,
    broadcaster,
    submissions: scoreSubmissions,
  })
  const botWiring = assembleBotWiring({
    app,
    broadcaster,
    completion,
    rooms,
    roundSync,
    scores,
    yachtActions,
  })
  yachtBots = botWiring.orchestrator

  return {
    rounds: {
      states: roundStates,
      synchronization: roundSync,
      scores,
      submissions: scoreSubmissions,
      deadlines: deadlineScheduler,
      deadlineStore,
      timer: roundTimer,
    },
    completion,
    rankings,
    botPolicy: botWiring.botPolicy,
    yachtActions,
    matchArchive,
    stopDeadlines: () => deadlineScheduler.stop(),
    stopBots: () => yachtBots?.stop(),
  }
}

/**
 * 라운드 진행 + 점수 확정의 조립.
 *
 * 조립 순서가 곧 의존 방향이다: 상태 저장소 → 동기화 서비스 → 타임아웃 해소기 → 타이머.
 * 타이머·해소기에는 **위에서 만든 그 브로드캐스터·레지스트리**를 넘긴다 — 여기서
 * `new RoomBroadcaster()`를 한 번만 더 쓰면 round.start·score.update가 아무 소켓도 없는
 * 브로드캐스터로 나가고, 빌드도 테스트도 통과한다(1.6 봇 라우트에서 이미 겪은 함정).
 *
 * ⚠️ 저장소는 **Redis 어댑터**다(3.1 `RedisYachtDiceStateStore`). 2.4의
 * `InMemoryRoundStateStore`는 테스트 시드이고, 그것을 여기 두면 재시작마다 진행 중
 * 게임이 사라지는데 **타입이 맞아서 아무 테스트도 깨지지 않는다**.
 */
function assembleRoundCore({
  app,
  broadcaster,
  redis,
  rooms,
}: Pick<RoundAssemblyDeps, 'app' | 'broadcaster' | 'redis' | 'rooms'>) {
  const roundStates = new RedisYachtDiceStateStore(redis)
  const roundSync = new RoundSynchronizationService(roundStates)
  const scores = new ScoreConfirmationService(new RedisScoreBoardStore(redis))
  const scoreSubmissions = new ScoreRoundSubmissionService<RoundSubmissionResult>(
    roundSync,
    scores,
    rooms,
  )
  const deadlineScheduler = new InMemoryRoundDeadlineScheduler({
    onError: (error, roomId) => app.log.error({ error, roomId }, '라운드 마감 처리 실패'),
  })
  // 마감 **시각**은 Redis로 나간다(PR 6). 예약기가 인메모리인 것은 그대로다 —
  // 프로세스 밖으로 나가는 것은 데이터이고, 발화 책임은 여전히 이 프로세스에 있다
  // (DESIGN.md 원칙 8: 분산 락도 pub/sub도 도입하지 않는다).
  const deadlineStore = new RedisRoundDeadlineStore(redis)
  const timeoutResolver = new RoundTimeoutResolver(
    {
      synchronizationService: roundSync,
      scoreRoundSubmission: scoreSubmissions,
      openCategories: scores,
      roomService: rooms,
      broadcaster,
    },
    {
      onDegraded: (roomId, reason, error) =>
        app.log.warn({ roomId, reason, error }, '마감 처리를 점수 없이 강등했습니다'),
    },
  )
  return {
    roundStates,
    roundSync,
    scores,
    scoreSubmissions,
    deadlineScheduler,
    deadlineStore,
    timeoutResolver,
  }
}

/**
 * 주간 랭킹(4.5) + 전적 보관(4.4)의 조립.
 *
 * 조립 순서가 곧 의존 방향이다: DB 저장소 → 캐시 데코레이터 → 서비스.
 * **캐시 인스턴스를 보관 서비스에 그대로 넘기는 것이 계약이다** — 새로 만들면 evict가
 * 아무도 읽지 않는 캐시를 비우고, 랭킹은 다음 재시작까지 낡은 채로 남는다.
 * 이름이 다르므로(`evictAll` ↔ `invalidateAll`) 한 줄 어댑터가 필요하다.
 */
function assembleRankingWiring({ app, db }: Pick<RoundAssemblyDeps, 'app' | 'db'>) {
  const rankingCache = new CachingWeeklyRankingRepository(new SqliteWeeklyRankingStore(db))
  const rankings = new WeeklyRankingService(rankingCache)
  const matchArchive = new MatchArchiveService(new SqliteMatchArchiveStore(db), {
    rankingCache: { invalidateAll: () => rankingCache.evictAll() },
    onArchived: (event) => app.log.info(event, '전적을 저장했습니다'),
    onDuplicate: (gameId) => app.log.info({ gameId }, '이미 저장된 판입니다'),
  })
  return { rankings, matchArchive }
}

/**
 * 게임 종료(2.7)의 조립.
 *
 * 라운드 타이머·듀얼·탁구가 **이 인스턴스**를 종료 판정으로 받는다. 예전에는 항상
 * false를 돌려주는 경고 스텁이 있었고, 그 상태에서는 게임이 FINISHED가 돼도
 * `game.over`·`state.sync`가 나가지 않아 클라이언트가 결과 화면으로 넘어가지 못했다.
 * 보관 실패는 여기서 삼켜 `onArchiveFailure`로 흐른다 — DB가 실패해도 게임은 끝난다.
 */
function assembleCompletionWiring({
  app,
  broadcaster,
  deadlineScheduler,
  matchArchive,
  redis,
  registry,
  rooms,
  snapshots,
}: Pick<RoundAssemblyDeps, 'app' | 'broadcaster' | 'redis' | 'registry' | 'rooms' | 'snapshots'> & {
  readonly matchArchive: MatchArchiveService
  readonly deadlineScheduler: RoundDeadlineScheduler
}) {
  return new GameCompletionService(
    {
      completionStore: new RedisGameCompletionStore(redis),
      deadlineScheduler,
      roomService: rooms,
      presence: registry,
      realtimeSnapshots: snapshots,
      broadcaster,
      matchArchive,
    },
    {
      onFinished: (event) => app.log.info(event, '게임이 종료됐습니다'),
      onArchiveFailure: (roomId, error) => app.log.error({ roomId, error }, '전적 보관 실패'),
    },
  )
}
