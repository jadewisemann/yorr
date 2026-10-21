import type { FastifyInstance } from 'fastify'
import { authOptions } from '../auth/config.js'
import { GoogleOAuthClient } from '../auth/googleClient.js'
import { KakaoOAuthClient } from '../auth/kakaoClient.js'
import { LoginCodeStore } from '../auth/loginCodeStore.js'
import { SqliteSocialAccountStore } from '../auth/socialAccountStore.js'
import { SocialLoginService } from '../auth/socialLoginService.js'
import { OAuthStateStore } from '../auth/stateStore.js'
import type { Env } from '../config/env.js'
import type { GameCatalog } from '../game/catalog.js'
import type { GameLifecycleService } from '../game/lifecycle.js'
import type { MatchArchiveService } from '../game/match/index.js'
import { PingPongAiResultService } from '../game/pingpong/index.js'
import type { GameScoreQueryService } from '../game/query/index.js'
import type { WeeklyRankingService } from '../game/ranking/index.js'
import type { Redis } from '../infra/memoryRedis.js'
import type { Pool } from '../infra/sqlite.js'
import type { BotParticipantService } from '../room/botService.js'
import type { QuickMatchService } from '../room/quickMatchService.js'
import type { RoomService } from '../room/roomService.js'
import type { UserProfileService } from '../user/profile.js'
import type { UserService } from '../user/session.js'
import type { RoomBroadcaster } from '../ws/broadcaster.js'
import type { RealtimeRoomSnapshotService } from '../ws/snapshot.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerGameQueryRoutes } from './routes/gameQueries.js'
import { registerGameRoutes } from './routes/games.js'
import { registerPingPongAiRoutes } from './routes/pingPongAi.js'
import { registerQuickMatchRoutes } from './routes/quickMatch.js'
import { registerRankingRoutes } from './routes/ranking.js'
import { registerRoomRoutes } from './routes/rooms.js'
import { registerUserRoutes } from './routes/users.js'

/**
 * `/api/v1` 라우트 등록 묶음 — `server.ts`의 조립에서 떼어낸 배선.
 *
 * 왜 분리했나: `createServer` 하나가 저장소·서비스 조립과 라우트 등록과 수명주기를
 * 모두 담아 227줄이었다. 라우트 등록은 **"무엇이 어디에 붙는가"**만 말하므로 조립과
 * 다른 관심사다.
 *
 * 배선에서 반복해서 지켜야 하는 규칙이 있다 — **게이트웨이와 같은 인스턴스**를
 * 넘긴다. 새로 만들면 타입도 테스트도 통과하는데 방송만 허공으로 간다. 그래서 이
 * 함수는 인스턴스를 만들지 않고 **받기만** 한다.
 */
export interface ApiRouteDependencies {
  readonly app: FastifyInstance
  readonly env: Env
  readonly redis: Redis
  readonly db: Pool
  readonly users: UserService
  readonly rooms: RoomService
  readonly catalog: GameCatalog
  readonly lifecycle: GameLifecycleService
  readonly queries: GameScoreQueryService
  readonly profiles: UserProfileService
  readonly quickMatches: QuickMatchService
  readonly bots: BotParticipantService
  readonly broadcaster: RoomBroadcaster
  readonly snapshots: RealtimeRoomSnapshotService
  readonly rankings: WeeklyRankingService
  readonly matchArchive: MatchArchiveService
}

export const registerApiRoutes = async (deps: ApiRouteDependencies): Promise<void> => {
  const { app, db, redis, users, rooms, catalog, lifecycle } = deps

  await app.register(
    async (api) => {
      await registerRoomRoutes(api, {
        users,
        rooms,
        catalog,
        lifecycle,
        // 봇 API는 WS 게이트웨이와 **같은** 브로드캐스터·스냅샷 인스턴스를 받아야
        // state.sync가 실제 소켓으로 나간다(rooms.ts의 RoomRouteDependencies 참고).
        bots: deps.bots,
        broadcaster: deps.broadcaster,
        snapshots: deps.snapshots,
      })
      await registerGameRoutes(api, { rooms })
      // 조회 REST(2.9). 등록 전에는 `/rooms/{id}/scores`·`/results`·
      // `/games/{id}/score-candidates`가 조용히 404다.
      await registerGameQueryRoutes(api, { users, queries: deps.queries })
      // 프로필(4.3)·랭킹(4.5)·퀵매치(3.5)도 같다 — 배선이 곧 존재 여부다.
      await registerUserRoutes(api, { users, profiles: deps.profiles })
      await registerQuickMatchRoutes(api, { users, catalog, matches: deps.quickMatches })
      await registerRankingRoutes(api, { users, rankings: deps.rankings })
      // 로컬 AI 탁구 결과(4.6). **조립에서 만든 그 `matchArchive`**를 넘긴다 — 새로
      // 만들면 주간 랭킹 캐시 evict(4.5)가 아무도 읽지 않는 캐시를 비운다.
      await registerPingPongAiRoutes(api, {
        users,
        results: new PingPongAiResultService(deps.matchArchive),
      })
      // 소셜 로그인(4.2). 제공자 설정이 비어 있어도 **라우트는 등록한다** — 미설정은
      // 404가 아니라 호출 시점의 503이 계약이다(docs/design/auth.md).
      // 회원 저장소는 DB 하나로 조회·가입을 모두 만족한다(별도 트랜잭션 경계는
      // 저장소 안에 있다).
      const accounts = new SqliteSocialAccountStore(db)
      const auth = authOptions(deps.env)
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
    { prefix: '/api/v1' },
  )
}
