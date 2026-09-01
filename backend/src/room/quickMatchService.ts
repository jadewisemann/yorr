import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import { ConflictError, DomainError } from '../errors.js'
import type { GameCatalog } from '../game/catalog.js'
import { type LuaScript, registerLuaScripts, runLuaNumber } from '../infra/lua.js'
import type { UserIdentity, UserService } from '../user/session.js'
import { roomKey } from './keys.js'
import type { RoomService } from './roomService.js'
import { ROOM_TTL_SECONDS } from './roomService.js'

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
 */

/** 대기 티켓·큐 잔류 시간. 이 시간을 넘긴 대기자는 매칭 시도마다 점수 윈도로 청소된다. */
export const QUICK_MATCH_WAIT_TTL_SECONDS = 5 * 60

/** 게임 코드별 매칭 락의 수명. 매칭 한 번(방 생성 + join N회)보다 넉넉하다. */
export const QUICK_MATCH_LOCK_TTL_SECONDS = 5

/**
 * `WebSocket.OPEN`. `ws/socket.ts`의 `SOCKET_OPEN`과 같은 값을 여기 다시 적는다 —
 * 방 도메인이 전송 계층 모듈에 의존하지 않기 위해서다(`game/round/roundPorts.ts`가
 * `RoundBroadcaster`를 직접 선언한 것과 같은 판단).
 */
const SOCKET_OPEN = 1

/** ZSET 점수는 enqueue 시각(ms)이다 — 오름차순 = 오래 기다린 순. */
export const quickMatchQueueKey = (gameCode: string): string => `quick-match:queue:${gameCode}`

/**
 * 사용자당 티켓 하나. **`UserService.clearRoom`이 이 키를 지운다**(방을 떠나면
 * 티켓도 사라진다) — 그 규약이 이미 1.2에 이식돼 있으므로 키 이름을 바꿀 수 없다.
 */
export const quickMatchTicketKey = (userId: string): string => `quick-match:user:${userId}`

export const quickMatchLockKey = (gameCode: string): string => `quick-match:lock:${gameCode}`

/** 방에 붙는 "전원 접속 시 자동 시작" 마커. 시작하거나 이미 시작됐으면 지운다. */
export const quickMatchMarkerKey = (roomCode: string): string => `${roomKey(roomCode)}:quick-match`

/** 세션 해시. `user/session.ts`의 것과 같은 이름이며 그쪽은 내부 헬퍼다. */
const userKey = (userId: string): string => `user:${userId}`

/**
 * KEYS: lock / ARGV: token → 지운 개수(내 토큰이 아니면 0).
 *
 * 락을 그냥 DEL하면 TTL로 이미 풀린 뒤 남이 잡은 락을 지운다.
 */
export const QUICK_MATCH_UNLOCK: LuaScript = {
  name: 'yorrQuickMatchUnlock',
  numberOfKeys: 1,
  lua: `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`,
}

export const QUICK_MATCH_SCRIPTS: readonly LuaScript[] = [QUICK_MATCH_UNLOCK]

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

/** `GameLifecycleService.start`의 자리. 퀵매치는 반환값을 쓰지 않는다. */
export interface QuickMatchGameStarter {
  start(roomCode: string): Promise<unknown>
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
  private readonly catalog: GameCatalog
  private readonly presence: QuickMatchPresence
  private readonly games: QuickMatchGameStarter
  private readonly now: () => number

  constructor(deps: QuickMatchServiceDeps, options: QuickMatchServiceOptions = {}) {
    this.redis = deps.redis
    this.rooms = deps.rooms
    this.users = deps.users
    this.catalog = deps.catalog
    this.presence = deps.presence
    this.games = deps.games
    this.now = options.now ?? (() => Date.now())
    registerLuaScripts(this.redis, QUICK_MATCH_SCRIPTS)
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
    const playerCount = this.playerCount(gameCode)

    const ticket = quickMatchTicketKey(user.userId)
    await this.redis.hset(ticket, { status: 'WAITING', gameCode })
    await this.redis.expire(ticket, QUICK_MATCH_WAIT_TTL_SECONDS)
    await this.redis.zadd(quickMatchQueueKey(gameCode), this.now(), user.userId)
    await this.match(gameCode, playerCount)
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
    if (response.roomId !== null) await this.startIfReady(response.roomId)
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
   * 게임 코드별 락 안에서 한 판을 성립시킨다. 락을 못 잡으면 **조용히 돌아간다** —
   * 다른 요청이 지금 매칭 중이고, 그쪽이 내 큐 항목까지 함께 본다.
   *
   * 순서가 계약이다: 만료 대기자 청소 → 최장 대기 N명 → 세션 확인(만료자 발견 시
   * 그 사람만 퇴출하고 **전체 중단**) → 방 생성 → join + assignRoom(도중 실패 시
   * 방 close로 롤백하고 재throw) → 큐에서 제거 → 티켓 MATCHED → 자동 시작 마커.
   */
  private async match(gameCode: string, playerCount: number): Promise<void> {
    const lockKey = quickMatchLockKey(gameCode)
    const token = randomUUID()
    const acquired = await this.redis.set(lockKey, token, 'EX', QUICK_MATCH_LOCK_TTL_SECONDS, 'NX')
    if (acquired !== 'OK') return
    try {
      const queue = quickMatchQueueKey(gameCode)
      await this.redis.zremrangebyscore(queue, 0, this.now() - QUICK_MATCH_WAIT_TTL_SECONDS * 1000)
      const candidates = await this.redis.zrange(queue, 0, playerCount - 1)
      if (candidates.length < playerCount) return
      const identities = await Promise.all(candidates.map((userId) => this.identity(userId)))
      if (identities.some((identity) => identity === null)) {
        // 세션이 만료된 사람은 방에 넣을 수 없다. 그 사람만 퇴출하고 이번 판은 접는다 —
        // 남은 사람들은 다음 enter/status의 매칭 시도에서 다시 후보가 된다.
        for (const [index, identity] of identities.entries()) {
          if (identity === null) await this.removeWaiting(gameCode, candidates[index] as string)
        }
        return
      }
      const players = identities as UserIdentity[]
      // 최장 대기자가 방장이다(ZSET 오름차순의 첫 항목).
      const host = players[0] as UserIdentity
      const roomId = await this.rooms.createRoom(playerCount, host.userId, gameCode)
      try {
        for (const player of players) {
          await this.rooms.join(roomId, player)
          await this.users.assignRoom(player.userId, roomId, roomId, host.userId)
        }
      } catch (error) {
        // 반쪽 방을 남기지 않는다. 롤백 실패는 감추지 않고 원인 예외 위로 올라간다.
        await this.rooms.close(roomId)
        throw error
      }
      await this.redis.zrem(queue, ...candidates)
      for (const player of players) await this.markMatched(player.userId, roomId, gameCode)
      await this.redis.set(quickMatchMarkerKey(roomId), '1', 'EX', ROOM_TTL_SECONDS)
    } finally {
      await runLuaNumber(this.redis, QUICK_MATCH_UNLOCK, [lockKey], [token])
    }
  }

  /**
   * **전원 소켓 라이브 조건 자동 시작.** 마커가 붙은 방만 대상이고, 조건이 하나라도
   * 어긋나면 아무것도 하지 않는다(다음 폴이 다시 시도한다).
   *
   * 이미 PLAYING인 방은 마커만 걷어낸다 — 다른 폴이 먼저 시작시킨 경우다.
   */
  private async startIfReady(roomId: string): Promise<void> {
    const marker = quickMatchMarkerKey(roomId)
    if ((await this.redis.exists(marker)) === 0) return
    const room = await this.rooms.getSnapshot(roomId)
    if (room.phase === 'PLAYING') {
      await this.redis.del(marker)
      return
    }
    if (room.phase !== 'LOBBY' || room.players.length !== room.capacity) return
    for (const player of room.players) {
      if (!this.isSocketLive(roomId, player.playerId)) return
    }
    try {
      await this.games.start(roomId)
      await this.redis.del(marker)
    } catch (error) {
      // 두 폴이 동시에 시작을 시도하면 진 쪽이 `game_not_ready`를 받는다. 방이 실제로
      // PLAYING이 됐으면 그 실패는 중복 시작이므로 삼킨다(마커는 이긴 쪽이 지웠다).
      if (!(error instanceof ConflictError)) throw error
      if ((await this.rooms.getSnapshot(roomId)).phase !== 'PLAYING') throw error
    }
  }

  /** 명단에 없거나 소켓이 없거나 열려 있지 않으면 라이브가 아니다. */
  private isSocketLive(roomId: string, playerId: string): boolean {
    const member = this.presence.find(roomId, playerId)
    return member !== null && member.socket !== null && member.socket.readyState === SOCKET_OPEN
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

  /** 세션 해시에서 정체성을 복원한다. 만료·손상이면 null(= 매칭 대상 아님). */
  private async identity(userId: string): Promise<UserIdentity | null> {
    const stored = await this.redis.hgetall(userKey(userId))
    const nickname = stored.nickname
    const type = stored.type
    if (nickname === undefined) return null
    if (type !== 'GUEST' && type !== 'MEMBER') return null
    return { userId, nickname, type }
  }

  /** 매칭된 티켓은 방과 같은 수명을 갖는다(대기 5분이 아니다 — 방이 살아 있는 동안 유효). */
  private async markMatched(userId: string, roomId: string, gameCode: string): Promise<void> {
    const ticket = quickMatchTicketKey(userId)
    await this.redis.hset(ticket, { status: 'MATCHED', roomId, gameCode })
    await this.redis.expire(ticket, ROOM_TTL_SECONDS)
  }

  private async removeWaiting(gameCode: string, userId: string): Promise<void> {
    await this.redis.zrem(quickMatchQueueKey(gameCode), userId)
    await this.redis.del(quickMatchTicketKey(userId))
  }

  /**
   * 매칭 인원 = `max(2, minPlayers)`. 1인 게임(야추)도 퀵매치는 둘부터고, 정원보다
   * 많이 필요한 게임은 큐를 열지 않는다.
   */
  private playerCount(gameCode: string): number {
    const game = this.catalog.require(gameCode)
    const playerCount = Math.max(2, game.minPlayers)
    if (playerCount > game.maxPlayers) throw new DomainError('quick_match_not_supported')
    return playerCount
  }
}
