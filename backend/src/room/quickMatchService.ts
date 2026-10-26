import { ConflictError } from '../errors.js'
import type { GameCatalog } from '../game/catalog.js'
import type { Redis } from '../infra/memoryRedis.js'
import type { UserIdentity, UserService } from '../user/session.js'
import {
  QUICK_MATCH_WAIT_TTL_SECONDS,
  quickMatchQueueKey,
  quickMatchTicketKey,
} from './quickMatchKeys.js'
import { type QuickMatchGameStarter, QuickMatchRunner } from './quickMatchRunner.js'
import type { RoomService } from './roomService.js'

export {
  QUICK_MATCH_LOCK_TTL_SECONDS,
  QUICK_MATCH_WAIT_TTL_SECONDS,
  quickMatchLockKey,
  quickMatchMarkerKey,
  quickMatchQueueKey,
  quickMatchTicketKey,
} from './quickMatchKeys.js'
export type { QuickMatchGameStarter } from './quickMatchRunner.js'

/**
 * 퀵매치.
 *
 * 세 개의 짧은 REST 호출(enter/status/cancel)이 전부이고 **자동 시작은 폴링이
 * 굴린다**: 프론트가 1초마다 `GET /quick-matches`를 두드리고, 그 호출이
 * "전원의 WS 소켓이 살아 있는가"를 확인해 게임을 시작한다
 * (docs/design/rooms-and-sessions.md 「퀵매치」).
 *
 * 원자성은 **게임 코드별 락 하나**로만 확보한다(DESIGN.md 원칙 7의 예외가 아니라
 * 한계다): 매칭과 방 생성이 한 Lua가 아니므로
 * 그 사이에 프로세스가 죽으면 방이 고아로 남을 수 있다. 락은 5초 TTL이라
 * 크래시가 큐를 영구히 막지는 않는다.
 *
 * 매칭·자동 시작 본체는 `quickMatchRunner.ts`, 키와 상수는 `quickMatchKeys.ts`가
 * 정본이다. 이 클래스는 사용자에게 보이는 세 호출의 뜻만 정한다.
 */

/** 세션 해시. `user/session.ts`의 것과 같은 이름이며 그쪽은 내부 헬퍼다. */
const userKey = (userId: string): string => `user:${userId}`

export type QuickMatchStatus = 'NOT_QUEUED' | 'WAITING' | 'MATCHED' | 'PLAYING'

/**
 * 와이어 계약 정본은 `frontend/src/room/api/quickMatchApi.ts`다 —
 * `{status, roomId, gameCode}`이고 **없는 값은 생략이 아니라 null**이다.
 */
export interface QuickMatchResponse {
  readonly status: QuickMatchStatus
  readonly roomId: string | null
  readonly gameCode: string | null
}

/**
 * 자동 시작의 조건인 **실제 소켓 생존**만 묻는 좁은 포트 — `RoomSessionRegistry`가
 * 그대로 만족한다.
 *
 * Redis 멤버십이 아니라 이쪽을 보는 것이 계약이다: 매칭은 방 명단을 먼저 채우므로
 * 멤버십으로 판정하면 "매칭됐는데 아직 접속하지 않은 사람"이 게임에 끌려 들어간다.
 * `status`가 아니라 소켓 객체를 보는 이유 —
 * 닫히는 중(CLOSING)인 소켓은 아직 명단에서 online이다.
 */
export interface QuickMatchPresence {
  find(
    roomId: string,
    playerId: string,
  ): { readonly socket: { readonly readyState: number } | null } | null
}

export interface QuickMatchServiceDeps {
  readonly redis: Redis
  readonly rooms: RoomService
  readonly users: UserService
  readonly catalog: GameCatalog
  readonly presence: QuickMatchPresence
  readonly games: QuickMatchGameStarter
}

export interface QuickMatchServiceOptions {
  /** 시각 주입 — 큐 점수 윈도(5분 청소) 테스트가 시간을 앞당긴다. */
  readonly now?: () => number
}

const notQueued = (gameCode: string | null): QuickMatchResponse => ({
  status: 'NOT_QUEUED',
  roomId: null,
  gameCode,
})

export class QuickMatchService {
  private readonly redis: Redis
  private readonly rooms: RoomService
  private readonly users: UserService
  private readonly now: () => number
  private readonly runner: QuickMatchRunner

  constructor(deps: QuickMatchServiceDeps, options: QuickMatchServiceOptions = {}) {
    this.redis = deps.redis
    this.rooms = deps.rooms
    this.users = deps.users
    this.now = options.now ?? (() => Date.now())
    this.runner = new QuickMatchRunner(
      {
        redis: deps.redis,
        rooms: deps.rooms,
        users: deps.users,
        catalog: deps.catalog,
        presence: deps.presence,
        games: deps.games,
      },
      this.now,
    )
  }

  /**
   * 큐에 들어간다. **멱등**이다 — 이미 티켓이 있으면 지금 상태를 그대로 돌려준다
   * (프론트가 버튼을 두 번 눌러도 큐가 두 줄이 되지 않는다).
   *
   * @throws DomainError `invalid_game_code`(카탈로그) · `quick_match_not_supported`
   * @throws ConflictError `already_in_room` — 세션에 방이 적혀 있을 때
   */
  async enter(user: UserIdentity, gameCode: string): Promise<QuickMatchResponse> {
    const current = await this.statusOf(user.userId)
    if (current.status !== 'NOT_QUEUED') return current
    if ((await this.redis.hexists(userKey(user.userId), 'roomId')) === 1) {
      throw new ConflictError('already_in_room')
    }
    const playerCount = this.runner.playerCount(gameCode)

    const ticket = quickMatchTicketKey(user.userId)
    await this.redis.hset(ticket, { status: 'WAITING', gameCode })
    await this.redis.expire(ticket, QUICK_MATCH_WAIT_TTL_SECONDS)
    await this.redis.zadd(quickMatchQueueKey(gameCode), this.now(), user.userId)
    await this.runner.match(gameCode, playerCount)
    // 내가 방금 만든 매칭이면 이 호출에서 곧바로 MATCHED가 나간다.
    return this.status(user.userId)
  }

  /**
   * 폴링 진입점. 조회처럼 보이지만 **부수효과가 둘** 있다(계약):
   * 1. 마커가 있는 방은 조건이 맞으면 여기서 시작된다(`startIfReady`).
   * 2. PLAYING을 한 번 보고하면 티켓을 소비한다 — 다음 폴은 NOT_QUEUED다.
   */
  async status(userId: string): Promise<QuickMatchResponse> {
    const response = await this.statusOf(userId)
    if (response.roomId !== null) await this.runner.startIfReady(response.roomId)
    const current = await this.statusOf(userId)
    if (current.status === 'PLAYING') await this.redis.del(quickMatchTicketKey(userId))
    return current
  }

  /** 대기 중일 때만 취소된다. 이미 매칭된 뒤라면 현재 상태를 그대로 돌려준다. */
  async cancel(userId: string): Promise<QuickMatchResponse> {
    const current = await this.statusOf(userId)
    if (current.status !== 'WAITING') return current
    // WAITING 티켓에는 항상 gameCode가 있다. 없으면 큐에 들어간 적이 없으므로 지울 것도 없다.
    if (current.gameCode !== null) {
      await this.redis.zrem(quickMatchQueueKey(current.gameCode), userId)
    }
    await this.redis.del(quickMatchTicketKey(userId))
    return notQueued(current.gameCode)
  }

  /**
   * 티켓 하나를 상태로 읽는다. 여기가 **자기 치유 지점**이다 — 티켓이 물고 있는 방이
   * 사라졌거나 FINISHED면 좌석·세션·티켓을 정리하고 NOT_QUEUED로 답한다.
   * (`clearRoom`이 티켓 키까지 지운다 — 1.2의 규약.)
   *
   * gameCode는 정리 후에도 그대로 실어 보낸다: 프론트가 "직전에 무슨 게임을
   * 기다렸는지"로 화면을 되돌린다.
   */
  private async statusOf(userId: string): Promise<QuickMatchResponse> {
    const ticket = await this.redis.hgetall(quickMatchTicketKey(userId))
    if (Object.keys(ticket).length === 0) return notQueued(null)
    const gameCode = ticket.gameCode ?? null
    const roomId = ticket.roomId ?? null
    if (roomId === null) return { status: 'WAITING', roomId: null, gameCode }
    const room = await this.rooms.getSnapshot(roomId)
    if (room.phase === null || room.phase === 'FINISHED') {
      // 방이 이미 없으면 뺄 좌석도 없다. FINISHED면 좌석이 남아 있어 다음 매칭의
      // 정원을 갉아먹으므로 여기서 빼 준다.
      if (room.phase === 'FINISHED') await this.rooms.leave(roomId, userId)
      await this.users.clearRoom(userId)
      return notQueued(gameCode)
    }
    return { status: room.phase === 'PLAYING' ? 'PLAYING' : 'MATCHED', roomId, gameCode }
  }
}
