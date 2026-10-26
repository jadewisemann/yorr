import { randomUUID } from 'node:crypto'
import { ConflictError, DomainError } from '../errors.js'
import type { GameCatalog } from '../game/catalog.js'
import type { Redis } from '../infra/memoryRedis.js'
import { runAtomicNumber, UNLOCK_IF_OWNER } from '../infra/memoryRedis.js'
import type { UserIdentity, UserService } from '../user/session.js'
import {
  QUICK_MATCH_LOCK_TTL_SECONDS,
  QUICK_MATCH_WAIT_TTL_SECONDS,
  quickMatchLockKey,
  quickMatchMarkerKey,
  quickMatchQueueKey,
  quickMatchTicketKey,
} from './quickMatchKeys.js'
import type { QuickMatchPresence } from './quickMatchService.js'
import type { RoomService } from './roomService.js'
import { ROOM_TTL_SECONDS } from './roomService.js'

/** `WebSocket.OPEN`. `ws/socket.ts`의 `SOCKET_OPEN`과 같은 값(`roundPorts.ts`와 같은 판단). */
const SOCKET_OPEN = 1

/** 세션 해시. `user/session.ts`의 것과 같은 이름이며 그쪽은 내부 헬퍼다. */
const userKey = (userId: string): string => `user:${userId}`

/** `GameLifecycleService.start`의 자리. 퀵매치는 반환값을 쓰지 않는다. */
export interface QuickMatchGameStarter {
  start(roomCode: string): Promise<unknown>
}

export interface QuickMatchRunnerDeps {
  readonly redis: Redis
  readonly rooms: RoomService
  readonly users: UserService
  readonly catalog: GameCatalog
  readonly presence: QuickMatchPresence
  readonly games: QuickMatchGameStarter
}

/**
 * 퀵매치의 **매칭과 자동 시작** — 큐에서 한 판을 성립시키고, 전원 접속이면 시작한다.
 *
 * 서비스(`quickMatchService.ts`)에서 갈라 둔 이유: 이쪽은 락·ZSET·방 생성이라는
 * 저장소 조작이고, 서비스는 사용자에게 보이는 세 호출(enter/status/cancel)의 뜻을
 * 정한다. 원자성 범위(게임 코드별 락 하나)를 읽을 때 상태 조회까지 지나치지 않게 한다.
 */
export class QuickMatchRunner {
  constructor(
    private readonly deps: QuickMatchRunnerDeps,
    private readonly now: () => number,
  ) {}

  /**
   * 게임 코드별 락 안에서 한 판을 성립시킨다. 락을 못 잡으면 **조용히 돌아간다** —
   * 다른 요청이 지금 매칭 중이고, 그쪽이 내 큐 항목까지 함께 본다.
   *
   * 순서가 계약이다: 만료 대기자 청소 → 최장 대기 N명 → 세션 확인(만료자 발견 시
   * 그 사람만 퇴출하고 **전체 중단**) → 방 생성 → join + assignRoom(도중 실패 시
   * 방 close로 롤백하고 재throw) → 큐에서 제거 → 티켓 MATCHED → 자동 시작 마커.
   */
  async match(gameCode: string, playerCount: number): Promise<void> {
    const lockKey = quickMatchLockKey(gameCode)
    const token = randomUUID()
    const acquired = await this.deps.redis.set(
      lockKey,
      token,
      'EX',
      QUICK_MATCH_LOCK_TTL_SECONDS,
      'NX',
    )
    if (acquired !== 'OK') return
    try {
      const queue = quickMatchQueueKey(gameCode)
      await this.deps.redis.zremrangebyscore(
        queue,
        0,
        this.now() - QUICK_MATCH_WAIT_TTL_SECONDS * 1000,
      )
      const candidates = await this.deps.redis.zrange(queue, 0, playerCount - 1)
      if (candidates.length < playerCount) return
      const players = await this.identitiesOf(gameCode, candidates)
      if (players === null) return
      const roomId = await this.createRoomWithPlayers(playerCount, gameCode, players)
      await this.deps.redis.zrem(queue, ...candidates)
      for (const player of players) await this.markMatched(player.userId, roomId, gameCode)
      await this.deps.redis.set(quickMatchMarkerKey(roomId), '1', 'EX', ROOM_TTL_SECONDS)
    } finally {
      await runAtomicNumber(this.deps.redis, UNLOCK_IF_OWNER, [lockKey], [token])
    }
  }

  /**
   * 후보 전원의 세션을 복원한다. 한 명이라도 만료면 **그 사람만 퇴출하고 null** —
   * 남은 사람들은 다음 enter/status의 매칭 시도에서 다시 후보가 된다.
   */
  private async identitiesOf(
    gameCode: string,
    candidates: readonly string[],
  ): Promise<UserIdentity[] | null> {
    const identities = await Promise.all(candidates.map((userId) => this.identity(userId)))
    if (!identities.some((identity) => identity === null)) return identities as UserIdentity[]
    for (const [index, identity] of identities.entries()) {
      if (identity === null) await this.removeWaiting(gameCode, candidates[index] as string)
    }
    return null
  }

  /** 방을 만들고 전원을 앉힌다. 도중 실패면 방을 닫고 원인을 그대로 올린다. */
  private async createRoomWithPlayers(
    playerCount: number,
    gameCode: string,
    players: readonly UserIdentity[],
  ): Promise<string> {
    // 최장 대기자가 방장이다(ZSET 오름차순의 첫 항목).
    const host = players[0] as UserIdentity
    const roomId = await this.deps.rooms.createRoom(playerCount, host.userId, gameCode)
    try {
      for (const player of players) {
        await this.deps.rooms.join(roomId, player)
        await this.deps.users.assignRoom(player.userId, roomId, roomId, host.userId)
      }
    } catch (error) {
      // 반쪽 방을 남기지 않는다. 롤백 실패는 감추지 않고 원인 예외 위로 올라간다.
      await this.deps.rooms.close(roomId)
      throw error
    }
    return roomId
  }

  /**
   * **전원 소켓 라이브 조건 자동 시작.** 마커가 붙은 방만 대상이고, 조건이 하나라도
   * 어긋나면 아무것도 하지 않는다(다음 폴이 다시 시도한다).
   *
   * 이미 PLAYING인 방은 마커만 걷어낸다 — 다른 폴이 먼저 시작시킨 경우다.
   */
  async startIfReady(roomId: string): Promise<void> {
    const marker = quickMatchMarkerKey(roomId)
    if ((await this.deps.redis.exists(marker)) === 0) return
    const room = await this.deps.rooms.getSnapshot(roomId)
    if (room.phase === 'PLAYING') {
      await this.deps.redis.del(marker)
      return
    }
    if (room.phase !== 'LOBBY' || room.players.length !== room.capacity) return
    for (const player of room.players) {
      if (!this.isSocketLive(roomId, player.playerId)) return
    }
    try {
      await this.deps.games.start(roomId)
      await this.deps.redis.del(marker)
    } catch (error) {
      // 두 폴이 동시에 시작을 시도하면 진 쪽이 `game_not_ready`를 받는다. 방이 실제로
      // PLAYING이 됐으면 그 실패는 중복 시작이므로 삼킨다(마커는 이긴 쪽이 지웠다).
      if (!(error instanceof ConflictError)) throw error
      if ((await this.deps.rooms.getSnapshot(roomId)).phase !== 'PLAYING') throw error
    }
  }

  /** 명단에 없거나 소켓이 없거나 열려 있지 않으면 라이브가 아니다. */
  private isSocketLive(roomId: string, playerId: string): boolean {
    const member = this.deps.presence.find(roomId, playerId)
    return member !== null && member.socket !== null && member.socket.readyState === SOCKET_OPEN
  }

  /** 세션 해시에서 정체성을 복원한다. 만료·손상이면 null(= 매칭 대상 아님). */
  private async identity(userId: string): Promise<UserIdentity | null> {
    const stored = await this.deps.redis.hgetall(userKey(userId))
    const nickname = stored.nickname
    const type = stored.type
    if (nickname === undefined) return null
    if (type !== 'GUEST' && type !== 'MEMBER') return null
    return { userId, nickname, type }
  }

  /** 매칭된 티켓은 방과 같은 수명을 갖는다(대기 5분이 아니다 — 방이 살아 있는 동안 유효). */
  private async markMatched(userId: string, roomId: string, gameCode: string): Promise<void> {
    const ticket = quickMatchTicketKey(userId)
    await this.deps.redis.hset(ticket, { status: 'MATCHED', roomId, gameCode })
    await this.deps.redis.expire(ticket, ROOM_TTL_SECONDS)
  }

  private async removeWaiting(gameCode: string, userId: string): Promise<void> {
    await this.deps.redis.zrem(quickMatchQueueKey(gameCode), userId)
    await this.deps.redis.del(quickMatchTicketKey(userId))
  }

  /**
   * 매칭 인원 = `max(2, minPlayers)`. 1인 게임(야추)도 퀵매치는 둘부터고, 정원보다
   * 많이 필요한 게임은 큐를 열지 않는다.
   */
  playerCount(gameCode: string): number {
    const game = this.deps.catalog.require(gameCode)
    const playerCount = Math.max(2, game.minPlayers)
    if (playerCount > game.maxPlayers) throw new DomainError('quick_match_not_supported')
    return playerCount
  }
}
