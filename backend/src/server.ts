import cors from '@fastify/cors'
import fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import { authOptions } from './auth/config.js'
import { GoogleOAuthClient } from './auth/googleClient.js'
import { KakaoOAuthClient } from './auth/kakaoClient.js'
import { LoginCodeStore } from './auth/loginCodeStore.js'
import { SqliteSocialAccountStore } from './auth/socialAccountStore.js'
import { SocialLoginService } from './auth/socialLoginService.js'
import { OAuthStateStore } from './auth/stateStore.js'
import { registerGameModules } from './composition/games.js'
import { assembleRoundWiring, type RoundWiring } from './composition/rounds.js'
import { allowedOrigins, type Env } from './config/env.js'
import { GameCatalog } from './game/catalog.js'
import type { GameCompletionService } from './game/completion/index.js'
import { GameLifecycleService } from './game/lifecycle.js'
import { GameModuleRegistry } from './game/module.js'
import { PingPongAiResultService } from './game/pingpong/index.js'
import { GameScoreQueryService, RedisGameScoreQueryStore } from './game/query/index.js'
import type { WeeklyRankingService } from './game/ranking/index.js'
import {
  GameReconnectSnapshotService,
  OrphanedRoundStateSweeper,
  type SweepScheduler,
} from './game/reconnect/index.js'
import { resumeGamesOnStartup } from './game/startupResume.js'
import type { YachtBotPolicy } from './game/yacht/index.js'
import { registerAuthRoutes } from './http/routes/auth.js'
import { registerGameQueryRoutes } from './http/routes/gameQueries.js'
import { registerGameRoutes } from './http/routes/games.js'
import { registerHealthRoutes } from './http/routes/health.js'
import { registerPingPongAiRoutes } from './http/routes/pingPongAi.js'
import { registerQuickMatchRoutes } from './http/routes/quickMatch.js'
import { registerRankingRoutes } from './http/routes/ranking.js'
import { registerRoomRoutes } from './http/routes/rooms.js'
import { registerUserRoutes } from './http/routes/users.js'
import { MemoryRedis, type Redis } from './infra/memoryRedis.js'
import type { Pool } from './infra/sqlite.js'
import { closeDbPool, createDbPool } from './infra/sqlite.js'
import {
  dbReadinessCheck,
  ReadinessService,
  RealtimeGameMetrics,
  redisReadinessCheck,
} from './monitoring/index.js'
import { BotParticipantService } from './room/botService.js'
import { InMemoryRoomCloseScheduler } from './room/closeScheduler.js'
import { QuickMatchService } from './room/quickMatchService.js'
import { RoomService } from './room/roomService.js'
import { SqliteUserProfileStore, UserProfileService } from './user/profile.js'
import { UserService } from './user/session.js'
import { RoomBroadcaster } from './ws/broadcaster.js'
import { attachGameSocketGateway, type GameSocketGateway } from './ws/gateway.js'
import { GameSocketHandler } from './ws/handler.js'
import { HeartbeatMonitor } from './ws/heartbeat.js'
import type { WsRoomSnapshot } from './ws/protocol.js'
import { RoomSessionRegistry } from './ws/registry.js'
import { RealtimeRoomSnapshotService } from './ws/snapshot.js'

/** REST base. WebSocket은 `/ws/v1/game`(gateway.ts) — 둘 다 계약이다. */
const API_PREFIX = '/api/v1'

export interface ServerOptions {
  /** 통합 테스트가 자기 Redis를 넘긴다. 없으면 env로 새로 만들고 종료 시 함께 닫는다. */
  readonly redis?: Redis
  /**
   * DB 풀(SQLite). Redis와 같은 규약이다 — 주입하면 **주입한 쪽이 닫는다**.
   * `main.ts`는 자기가 만든 풀을 넘기고, 통합 테스트는 인메모리 풀을 넘긴다.
   */
  readonly db?: Pool
  /**
   * Fastify 로거 설정. 운영은 생략한다(`true`). 블랙박스 하네스는 `{ stream }`을 넘겨
   * 로그를 모은다 — "핸들러 밖으로 새어 나온 예외가 0건"을 단정하는 유일한 창이다.
   */
  readonly logger?: FastifyServerOptions['logger']
  /**
   * 고아 라운드 상태 스윕(2.8)의 주기 실행 시임 — **테스트 전용**이다. 운영은
   * 생략해 실제 5분 타이머를 쓴다. 배선 회귀 테스트가 5분을 기다리지 않고
   * "listen()이 실제로 주기를 걸었는가"를 확인하는 유일한 창이다.
   */
  readonly sweepScheduler?: SweepScheduler
}

export interface YorrServer {
  app: FastifyInstance
  gateway: GameSocketGateway
  registry: RoomSessionRegistry
  /** WS 게이트웨이·봇 REST·라운드 타이머가 공유하는 **그** 인스턴스. */
  broadcaster: RoomBroadcaster
  rounds: RoundWiring
  /**
   * 세 게임 모듈(3.1 야추·3.3 듀얼·3.4 탁구)이 등록된 **그** 레지스트리.
   * WS 게이트웨이와 `GameLifecycleService`가 같은 것을 본다.
   */
  games: GameModuleRegistry
  /**
   * 게임 종료 단일 진입점(2.7). 라운드 타이머·듀얼·탁구가 **이 인스턴스**를 받는다 —
   * 스텁이 남아 있으면 게임이 FINISHED가 되어도 `game.over`가 나가지 않는다.
   */
  completion: GameCompletionService
  /** 고아 라운드 상태 스윕(2.8). `listen()`이 `start()`, `close()`가 `stop()`을 부른다. */
  sweeper: OrphanedRoundStateSweeper
  /** 주간 랭킹(4.5). 상위 목록 캐시는 4.4의 보관 서비스가 evict하는 **그** 인스턴스다. */
  rankings: WeeklyRankingService
  /**
   * 봇 탐색 정책. 운영은 `CooperativeYachtBotPolicy`로 감싼 인스턴스다 — 배선 회귀
   * 테스트가 큐 래핑이 빠졌는지 확인하는 창이다.
   */
  botPolicy: YachtBotPolicy
  listen(): Promise<void>
  close(): Promise<void>
}

export const createServer = async (env: Env, options: ServerOptions = {}): Promise<YorrServer> => {
  const redis = options.redis ?? new MemoryRedis()
  const ownsRedis = options.redis === undefined
  // 풀 생성은 파일을 열지 않는다(infra/sqlite.ts) — 첫 질의 때 연다.
  const db = options.db ?? createDbPool(env)
  const ownsDb = options.db === undefined

  const users = new UserService(redis)
  const rooms = new RoomService(redis)
  const catalog = new GameCatalog()
  // 레지스트리·생명주기·WS 게이트웨이가 **같은** 카탈로그와 **같은** 레지스트리를
  // 봐야 한다. 새로 만들면 REST로 시작한 게임의 모듈 훅이 조용히 돌지 않는다
  // (빌드는 통과한다 — 기본값이 빈 레지스트리다).
  const games = new GameModuleRegistry(catalog)
  const lifecycle = new GameLifecycleService(rooms, catalog, games)

  const app = fastify({ logger: options.logger ?? true })

  const registry = new RoomSessionRegistry()
  const broadcaster = new RoomBroadcaster()
  const snapshots = new RealtimeRoomSnapshotService(rooms, registry)
  const heartbeat = new HeartbeatMonitor()
  const closeScheduler = new InMemoryRoomCloseScheduler((error, roomId) =>
    app.log.error({ error, roomId }, '빈 방 폐쇄 실패'),
  )

  const roundAssembly = assembleRoundWiring({
    app,
    broadcaster,
    db,
    redis,
    registry,
    rooms,
    snapshots,
  })
  const { rounds, completion, rankings, botPolicy, matchArchive } = roundAssembly

  // ── 조회(2.9) · 재접속 스냅샷(2.8) ───────────────────────────────────────
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
      ...(options.sweepScheduler === undefined ? {} : { scheduler: options.sweepScheduler }),
      onSwept: (roomId) => app.log.info({ roomId }, '방이 사라진 라운드 상태를 회수했습니다'),
      onError: (error) => app.log.error({ error }, '고아 라운드 상태 스윕 실패'),
    },
  )

  registerGameModules(games, {
    redis,
    registry,
    broadcaster,
    snapshots,
    deadlineScheduler: rounds.deadlines,
    completion,
    rooms,
    rounds: rounds.synchronization,
    timers: rounds.timer,
    yachtActions: roundAssembly.yachtActions,
    reconnectSnapshots,
  })

  // ── 회원 프로필(4.3) · 퀵매치(3.5) ──────────────────────────────────────
  const profiles = new UserProfileService(new SqliteUserProfileStore(db), users)
  // 퀵매치의 자동 시작 조건은 "전원의 WS 소켓이 살아 있는가"다 — WS 게이트웨이와
  // **같은 레지스트리**여야 한다. 새로 만들면 그 조건이 영구히 거짓이 되어 자동
  // 시작이 조용히 안 된다(타입체크는 통과한다).
  const quickMatches = new QuickMatchService({
    redis,
    rooms,
    users,
    catalog,
    presence: registry,
    games: lifecycle,
  })

  await app.register(cors, { origin: allowedOrigins(env) })
  // 게이지 수집은 WS 레지스트리의 인메모리 상태만 본다(스크레이프마다 Redis를
  // 때리면 모니터링이 부하 원인이 된다). **위에서 만든 그** 레지스트리·모듈
  // 레지스트리여야 한다 — 새로 만들면 게이지가 영구히 0인데 타입도 테스트도 통과한다.
  await registerHealthRoutes(app, {
    // readiness는 **위에서 만든 그** 저장소·DB를 두드린다 — 새 클라이언트를 만들면
    // 애플리케이션이 쓰는 좌표가 아니라 다른 좌표를 검사하게 되고, 그때 health는
    // 아무것도 증명하지 않는다(게이지 배선과 같은 종류의 함정이다).
    readiness: new ReadinessService([redisReadinessCheck(redis), dbReadinessCheck(db)], {
      onChanged: (result) =>
        result.ready
          ? app.log.info('readiness UP — 의존 확인이 전부 응답합니다')
          : app.log.error(
              {
                failed: result.failures.map((failure) => ({
                  name: failure.name,
                  reason:
                    failure.reason instanceof Error
                      ? failure.reason.message
                      : String(failure.reason),
                })),
              },
              'readiness DOWN — /actuator/health가 503을 냅니다',
            ),
    }),
    metrics: new RealtimeGameMetrics({ presence: registry, games }),
  })
  await app.register(
    async (api) => {
      await registerRoomRoutes(api, {
        users,
        rooms,
        catalog,
        lifecycle,
        // 봇 API는 WS 게이트웨이와 **같은** 브로드캐스터·스냅샷 인스턴스를 받아야
        // state.sync가 실제 소켓으로 나간다(rooms.ts의 RoomRouteDependencies 참고).
        bots: new BotParticipantService(redis, rooms),
        broadcaster,
        snapshots,
      })
      await registerGameRoutes(api, { rooms })
      // 조회 REST(2.9). 등록 전에는 `/rooms/{id}/scores`·`/results`·
      // `/games/{id}/score-candidates`가 조용히 404다.
      await registerGameQueryRoutes(api, { users, queries: gameQueries })
      // 프로필(4.3)·랭킹(4.5)·퀵매치(3.5)도 같다 — 배선이 곧 존재 여부다.
      await registerUserRoutes(api, { users, profiles })
      await registerQuickMatchRoutes(api, { users, catalog, matches: quickMatches })
      await registerRankingRoutes(api, { users, rankings })
      // 로컬 AI 탁구 결과(4.6). **위에서 만든 그 `matchArchive`**를 넘긴다 — 새로
      // 만들면 주간 랭킹 캐시 evict(4.5)가 아무도 읽지 않는 캐시를 비운다.
      await registerPingPongAiRoutes(api, {
        users,
        results: new PingPongAiResultService(matchArchive),
      })
      // 소셜 로그인(4.2). 제공자 설정이 비어 있어도 **라우트는 등록한다** — 미설정은
      // 404가 아니라 호출 시점의 503이 계약이다(docs/design/auth.md).
      // 회원 저장소는 DB 하나로 조회·가입을 모두 만족한다(별도 트랜잭션 경계는
      // 저장소 안에 있다).
      const accounts = new SqliteSocialAccountStore(db)
      const auth = authOptions(env)
      await registerAuthRoutes(api, {
        users,
        options: auth,
        kakao: new KakaoOAuthClient(auth.kakao),
        google: new GoogleOAuthClient(auth.google),
        state: new OAuthStateStore(redis),
        loginCodes: new LoginCodeStore(redis),
        logins: new SocialLoginService(accounts, accounts),
      })
    },
    { prefix: API_PREFIX },
  )

  await app.ready()
  const gateway = attachGameSocketGateway(
    app.server,
    new GameSocketHandler({
      registry,
      broadcaster,
      snapshots,
      heartbeat,
      users,
      rooms,
      closeScheduler,
      games,
      logger: app.log,
    }),
    { logger: app.log, allowedOrigins: allowedOrigins(env) },
  )

  return {
    app,
    gateway,
    registry,
    broadcaster,
    rounds,
    games,
    completion,
    sweeper,
    rankings,
    botPolicy,
    listen: async () => {
      /*
       * 부팅 재무장(PR 6). **`app.listen()`보다 먼저다** — 요청을 받기 시작한 뒤에
       * 되살리면 그 사이 도착한 재접속이 아직 비어 있는 마감을 보고 실패한다.
       *
       * 예전에는 이 자리가 `closeUnrecoverableGamesOnStartup`이었다. 마감 시각이
       * 프로세스 인메모리라 진행 중이던 방을 **전부** 닫는 것이 유일한 대책이었다.
       * 지금은 저장된 마감으로 이어가고, 이어갈 수 없는 방만 닫는다.
       */
      const resumeReport = await resumeGamesOnStartup(
        { rooms, games },
        {
          onResumed: (roomCode, gameCode) =>
            app.log.info({ roomCode, gameCode }, '진행 중이던 판을 이어갑니다'),
          onClosed: (roomCode, reason) =>
            app.log.warn({ roomCode, reason }, '이어갈 수 없는 진행 중 방을 닫았습니다'),
        },
      )
      if (resumeReport.resumed > 0 || resumeReport.closed > 0) {
        app.log.info(resumeReport, '부팅 재무장을 마쳤습니다')
      }
      // 방이 사라진 뒤 남은 라운드 상태 키를 5분마다 회수한다(2.8). 상태가 Redis에
      // 살기 시작한 뒤로는 실제로 고아가 생긴다 — 인메모리였을 때는 재시작이 청소했다.
      sweeper.start()
      await app.listen({ port: env.SERVER_PORT, host: '0.0.0.0' })
    },
    close: async () => {
      heartbeat.stop()
      closeScheduler.stop()
      // 스윕 주기를 먼저 끊는다 — 남아 있으면 닫힌 Redis로 SCAN을 던진다.
      sweeper.stop()
      // 걸려 있는 라운드 마감 타이머를 전부 끊는다. 안 하면 unref된 타이머가 남아
      // 이미 닫힌 Redis로 마감 처리를 시도한다(테스트에서는 스위트 간 누수가 된다).
      roundAssembly.stopDeadlines()
      roundAssembly.stopBots()
      await gateway.close()
      await app.close()
      if (ownsRedis) redis.disconnect()
      if (ownsDb) await closeDbPool(db)
    },
  }
}
