import cors from '@fastify/cors'
import fastify, { type FastifyInstance } from 'fastify'
import type { Redis } from 'ioredis'
import type { Pool } from 'mysql2/promise'
import { authOptions } from './auth/config.js'
import { GoogleOAuthClient } from './auth/googleClient.js'
import { KakaoOAuthClient } from './auth/kakaoClient.js'
import { LoginCodeStore } from './auth/loginCodeStore.js'
import { MysqlSocialAccountStore } from './auth/socialAccountStore.js'
import { SocialLoginService } from './auth/socialLoginService.js'
import { OAuthStateStore } from './auth/stateStore.js'
import { allowedOrigins, type Env } from './config/env.js'
import { GameCatalog } from './game/catalog.js'
import { GameLifecycleService } from './game/lifecycle.js'
import { GameModuleRegistry } from './game/module.js'
import {
  type GameCompletionPort,
  InMemoryRoundDeadlineScheduler,
  InMemoryRoundStateStore,
  type RoundDeadlineScheduler,
  type RoundStateStore,
  type RoundSubmissionResult,
  RoundSynchronizationService,
  RoundTimeoutResolver,
  RoundTimerService,
} from './game/round/index.js'
import {
  RedisScoreBoardStore,
  ScoreConfirmationService,
  ScoreRoundSubmissionService,
} from './game/score/index.js'
import { registerAuthRoutes } from './http/routes/auth.js'
import { registerGameRoutes } from './http/routes/games.js'
import { registerHealthRoutes } from './http/routes/health.js'
import { registerRoomRoutes } from './http/routes/rooms.js'
import { registerVoiceRoutes } from './http/routes/voice.js'
import { closeMysqlPool, createMysqlPool } from './infra/mysql.js'
import { createRedisClient } from './infra/redis.js'
import { BotParticipantService } from './room/botService.js'
import { InMemoryRoomCloseScheduler } from './room/closeScheduler.js'
import { RoomService } from './room/roomService.js'
import { closeUnrecoverableGamesOnStartup } from './room/staleRoomCleaner.js'
import { UserService } from './user/session.js'
import { RoomBroadcaster } from './ws/broadcaster.js'
import { attachGameSocketGateway, type GameSocketGateway } from './ws/gateway.js'
import { GameSocketHandler } from './ws/handler.js'
import { HeartbeatMonitor } from './ws/heartbeat.js'
import { VoiceIceService, voiceIceOptions } from './ws/iceServers.js'
import { RoomSessionRegistry } from './ws/registry.js'
import { RealtimeRoomSnapshotService } from './ws/snapshot.js'

/** REST base. WebSocket은 `/ws/v1/game`(gateway.ts) — 둘 다 계약이다. */
const API_PREFIX = '/api/v1'

export interface ServerOptions {
  /** 통합 테스트가 자기 Redis를 넘긴다. 없으면 env로 새로 만들고 종료 시 함께 닫는다. */
  readonly redis?: Redis
  /**
   * MySQL 풀. Redis와 같은 규약이다 — 주입하면 **주입한 쪽이 닫는다**.
   * `main.ts`는 기동 전 마이그레이션 확인(`verifyMigrations`)에 쓴 풀을 그대로
   * 넘기고, 통합 테스트는 자기 스키마를 가리키는 풀을 넘긴다.
   */
  readonly mysql?: Pool
  readonly logger?: boolean
}

/**
 * 라운드 진행 배선(2.5·2.6). 3.1(야추 모듈)이 여기 있는 것을 그대로 받아 쓴다 —
 * 새로 만들면 브로드캐스터·레지스트리가 갈라져 방송이 허공으로 나간다.
 */
export interface RoundWiring {
  readonly states: RoundStateStore
  readonly synchronization: RoundSynchronizationService
  readonly scores: ScoreConfirmationService
  readonly submissions: ScoreRoundSubmissionService<RoundSubmissionResult>
  /** `close()`가 `stop()`을 부른다 — 남은 마감 타이머가 이미 닫힌 Redis를 두드리지 않게. */
  readonly deadlines: RoundDeadlineScheduler
  readonly timer: RoundTimerService
}

export interface YorrServer {
  app: FastifyInstance
  gateway: GameSocketGateway
  registry: RoomSessionRegistry
  /** WS 게이트웨이·봇 REST·라운드 타이머가 공유하는 **그** 인스턴스. */
  broadcaster: RoomBroadcaster
  rounds: RoundWiring
  listen(): Promise<void>
  close(): Promise<void>
}

export const createServer = async (env: Env, options: ServerOptions = {}): Promise<YorrServer> => {
  const redis = options.redis ?? createRedisClient(env)
  const ownsRedis = options.redis === undefined
  // 풀 생성은 커넥션을 열지 않는다(infra/mysql.ts) — MySQL이 없어도 기동은 성공하고,
  // 실제 확인은 `main.ts`가 `verifyMigrations`로 한다.
  const mysql = options.mysql ?? createMysqlPool(env)
  const ownsMysql = options.mysql === undefined

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

  // ── 라운드 진행(2.5) + 점수 확정(2.6) ────────────────────────────────────
  // 조립 순서가 곧 의존 방향이다: 상태 저장소 → 동기화 서비스 → 타임아웃 해소기 →
  // 타이머. 타이머·해소기에는 **위에서 만든 그 브로드캐스터·레지스트리**를 넘긴다 —
  // 여기서 `new RoomBroadcaster()`를 한 번만 더 쓰면 round.start·score.update가
  // 아무 소켓도 없는 브로드캐스터로 나가고, 빌드도 테스트도 통과한다(1.6 봇 라우트에서
  // 이미 한 번 겪은 함정이다).
  const roundStates = new InMemoryRoundStateStore()
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
  /**
   * 2.7(GameCompletionService)이 아직 없다. 종료 판정을 할 사람이 없으므로 항상
   * "종료되지 않았다"로 답한다 — 라운드는 계속 진행되고, 라운드 상한에 닿으면 타이머가
   * `round_cap_reached_without_finish`로 멈춘다. **경고 로그가 이 자리의 유일한 흔적**이라
   * 2.7 배선을 빠뜨린 채 게임을 돌리면 조용히 끝나지 않는 대신 로그로 드러난다.
   */
  const gameCompletion: GameCompletionPort = {
    finishIfComplete: (roomId, force) => {
      app.log.warn({ roomId, force }, '게임 종료 판정이 아직 배선되지 않았습니다(2.7)')
      return false
    },
  }
  const roundTimer = new RoundTimerService(
    {
      timeoutResolver,
      deadlineScheduler,
      broadcaster,
      gameCompletion,
      synchronizationService: roundSync,
      presence: registry,
      roomService: rooms,
    },
    {
      onWarning: (roomId, reason) => app.log.warn({ roomId, reason }, '라운드 진행 중단'),
    },
  )

  await app.register(cors, { origin: allowedOrigins(env) })
  await registerHealthRoutes(app)
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
      await registerVoiceRoutes(api, { ice: new VoiceIceService(voiceIceOptions(env)) })
      // 소셜 로그인(4.2). 제공자 설정이 비어 있어도 **라우트는 등록한다** — 미설정은
      // 404가 아니라 호출 시점의 503이 계약이다(docs/design/auth.md).
      // 회원 저장소는 MySQL 하나로 조회·가입을 모두 만족한다(별도 트랜잭션 경계는
      // 저장소 안에 있다).
      const accounts = new MysqlSocialAccountStore(mysql)
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
    rounds: {
      states: roundStates,
      synchronization: roundSync,
      scores,
      submissions: scoreSubmissions,
      deadlines: deadlineScheduler,
      timer: roundTimer,
    },
    listen: async () => {
      // 부팅 시 정리: 마감 타이머가 하나도 없는 지금 PLAYING인 방은 이어갈 수 없다.
      const closed = await closeUnrecoverableGamesOnStartup(rooms)
      if (closed > 0) app.log.info({ closed }, '재시작으로 이어갈 수 없는 진행 중 방을 닫았습니다')
      await app.listen({ port: env.SERVER_PORT, host: '0.0.0.0' })
    },
    close: async () => {
      heartbeat.stop()
      closeScheduler.stop()
      // 걸려 있는 라운드 마감 타이머를 전부 끊는다. 안 하면 unref된 타이머가 남아
      // 이미 닫힌 Redis로 마감 처리를 시도한다(테스트에서는 스위트 간 누수가 된다).
      deadlineScheduler.stop()
      await gateway.close()
      await app.close()
      if (ownsRedis) redis.disconnect()
      if (ownsMysql) await closeMysqlPool(mysql)
    },
  }
}
