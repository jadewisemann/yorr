import { randomInt, randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import { ConflictError, DomainError } from '../errors.js'
import { registerLuaScripts, runLuaNumber } from '../infra/lua.js'
import type { UserIdentity } from '../user/session.js'
import {
  botsKey,
  gameKey,
  playersKey,
  ROOM_KEY_PREFIX,
  roomKey,
  roomKeyFamily,
  scoresKey,
} from './keys.js'
import {
  CANCEL_ACTIVE_GAME,
  CLOSE,
  CREATE,
  JOIN,
  LEAVE,
  RETURN_TO_LOBBY,
  ROLLBACK_START,
  ROOM_SCRIPTS,
  START,
  TOUCH,
} from './scripts.js'
import {
  type RoomMode,
  type RoomPhase,
  type RoomPlayerSnapshot,
  type RoomSnapshot,
  roomNotFound,
} from './snapshot.js'

const ROOM_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const ROOM_CODE_LENGTH = 6

/**
 * 방 키의 수명. 활동이 있으면 `touch`가 이 값으로 다시 늘리므로 실제 소멸 조건은
 * "이 시간 동안 아무 활동이 없었다"다.
 */
export const ROOM_TTL_SECONDS = 40 * 60

export interface GameStartResult {
  readonly gameId: string
  readonly snapshot: RoomSnapshot
}

const randomRoomCode = (): string => {
  let code = ''
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_CHARS[randomInt(ROOM_CODE_CHARS.length)]
  }
  return code
}

const parsePhase = (value: string | undefined): RoomPhase => {
  if (value === 'LOBBY' || value === 'PLAYING' || value === 'FINISHED') return value
  throw new Error(`알 수 없는 phase: ${value}`)
}

/**
 * 방 도메인의 Redis 접근 지점 — 방 생성·검증이 같은 키 가족을 다루므로 한 클래스다.
 *
 * **REST가 방 상태의 유일한 변경 경로다.** WS는 여기를 통해 멤버십을 바꾸지
 * 않는다(예외는 게임 모듈의 퇴장 경로 — docs/design/rooms-and-sessions.md).
 */
export class RoomService {
  constructor(private readonly redis: Redis) {
    // 등록은 멱등이라 같은 클라이언트를 공유하는 서비스가 여럿이어도 안전하다.
    registerLuaScripts(redis, ROOM_SCRIPTS)
  }

  /** 코드 충돌 시 CREATE가 0을 돌려주므로 성공할 때까지 다시 뽑는다. */
  async createRoom(
    capacity: number,
    hostId: string,
    gameCode: string,
    mode: RoomMode = 'NORMAL',
  ): Promise<string> {
    if (capacity < 1) throw new DomainError('invalid_capacity')
    if (gameCode.trim().length === 0) throw new DomainError('invalid_game_code')
    for (;;) {
      const roomCode = randomRoomCode()
      const created = await runLuaNumber(
        this.redis,
        CREATE,
        [roomKey(roomCode)],
        [capacity, hostId, gameCode, ROOM_TTL_SECONDS, mode],
      )
      if (created === 1) return roomCode
    }
  }

  /** `SCAN room:*` 후 `:`가 붙은 자식 키를 걸러낸다(KEYS 금지 — 운영 Redis가 멈춘다). */
  async getAllRoomCodes(): Promise<string[]> {
    const codes = new Set<string>()
    let cursor = '0'
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${ROOM_KEY_PREFIX}*`,
        'COUNT',
        100,
      )
      cursor = next
      for (const key of keys) {
        const roomCode = key.slice(ROOM_KEY_PREFIX.length)
        if (!roomCode.includes(':')) codes.add(roomCode)
      }
    } while (cursor !== '0')
    return [...codes]
  }

  /**
   * 방에 들어간다. 같은 사람의 재참가는 인원을 늘리지 않는다(중복 반환 4 = 성공 취급).
   *
   * userId·sessionToken은 호출부가 이미 쥐고 있는 값이라 스냅샷만 돌려준다.
   */
  async join(roomCode: string, user: UserIdentity): Promise<RoomSnapshot> {
    const result = await runLuaNumber(this.redis, JOIN, roomKeyFamily(roomCode), [
      user.userId,
      user.nickname,
    ])
    if (result === 0) throw new DomainError('room_not_found')
    if (result === 2) throw new ConflictError('game_started')
    if (result === 3) throw new ConflictError('room_full')
    return this.getSnapshot(roomCode)
  }

  /** @returns 방·좌석이 있었는지(없으면 false = 404 경로). */
  async leave(roomCode: string, playerId: string): Promise<boolean> {
    const result = await runLuaNumber(this.redis, LEAVE, roomKeyFamily(roomCode), [playerId])
    return result >= 0
  }

  /**
   * 방을 통째로 닫는다. 소켓만 끊긴 경우엔 `leave` 경로를 타지 않아 Redis에 빈
   * 방이 남는데, 그때 이 메서드가 정리한다. 이미 없는 방을 닫아도 안전하다.
   */
  async close(roomCode: string): Promise<void> {
    await runLuaNumber(this.redis, CLOSE, roomKeyFamily(roomCode))
  }

  /** 활동이 있었음을 알려 방 키 가족의 수명을 함께 다시 센다. 없는 방은 무해. */
  async touch(roomCode: string): Promise<void> {
    await runLuaNumber(this.redis, TOUCH, roomKeyFamily(roomCode), [ROOM_TTL_SECONDS])
  }

  async getSnapshot(roomCode: string): Promise<RoomSnapshot> {
    const room = await this.redis.hgetall(roomKey(roomCode))
    if (Object.keys(room).length === 0) return roomNotFound(roomCode)
    const [players, scores, bots] = await Promise.all([
      this.redis.hgetall(playersKey(roomCode)),
      this.redis.hgetall(scoresKey(roomCode)),
      this.redis.hgetall(botsKey(roomCode)),
    ])
    const snapshots = Object.entries(players)
      .map<RoomPlayerSnapshot>(([playerId, nickname]) => ({
        playerId,
        nickname,
        score: Number.parseInt(scores[playerId] ?? '0', 10),
        kind: playerId in bots ? 'BOT' : 'HUMAN',
      }))
      // 입장 순서가 남지 않으므로 playerId 오름차순 — LEAVE의 방장 승계와 같은 규칙이라
      // 화면 맨 위 사람이 방장이 된다.
      .sort((left, right) => (left.playerId < right.playerId ? -1 : 1))
    return {
      roomCode,
      gameCode: room.gameCode ?? null,
      gameId: room.gameId ?? null,
      hostId: room.hostId ?? null,
      phase: parsePhase(room.phase),
      capacity: Number.parseInt(room.capacity ?? '0', 10),
      players: snapshots,
    }
  }

  /** 실패 사유는 전부 `game_not_ready`로 뭉개진다 — START Lua의 계약(quirk)이다. */
  async startGame(roomCode: string, minPlayers = 1): Promise<GameStartResult> {
    if (minPlayers < 1) throw new DomainError('invalid_min_players')
    const gameId = randomUUID()
    const result = await runLuaNumber(
      this.redis,
      START,
      [roomKey(roomCode), playersKey(roomCode), gameKey(gameId), botsKey(roomCode)],
      [gameId, roomCode, minPlayers],
    )
    if (result !== 1) throw new ConflictError('game_not_ready')
    return { gameId, snapshot: await this.getSnapshot(roomCode) }
  }

  async rollbackStart(roomCode: string, gameId: string): Promise<boolean> {
    const result = await runLuaNumber(
      this.redis,
      ROLLBACK_START,
      [roomKey(roomCode), gameKey(gameId)],
      [gameId],
    )
    return result === 1
  }

  async cancelActiveGame(roomCode: string): Promise<boolean> {
    const result = await runLuaNumber(this.redis, CANCEL_ACTIVE_GAME, [roomKey(roomCode)])
    return result === 1
  }

  /** @returns 이 호출이 실제로 대기실로 되돌렸는지. 이미 대기실이면 false(멱등). */
  async returnToLobby(roomCode: string): Promise<boolean> {
    const result = await runLuaNumber(this.redis, RETURN_TO_LOBBY, roomKeyFamily(roomCode))
    return result === 1
  }

  /** 없는 방·mode가 없는 옛 방은 일반 방으로 본다. */
  async isPartyRoom(roomCode: string): Promise<boolean> {
    return (await this.redis.hget(roomKey(roomCode), 'mode')) === 'PARTY'
  }

  async getGameSnapshot(gameId: string): Promise<RoomSnapshot> {
    const roomCode = await this.redis.hget(gameKey(gameId), 'roomCode')
    return roomCode === null ? roomNotFound(null) : this.getSnapshot(roomCode)
  }
}
