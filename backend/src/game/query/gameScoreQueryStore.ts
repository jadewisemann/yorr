import { gameKey, playersKey, roomKey } from '../../room/keys.js'
import type { RoomPhase } from '../../room/snapshot.js'
import { readScoreBoard, type ScoreBoard } from '../score/index.js'
import { GameQueryDomainError, GameScoreQueryError } from './queryErrors.js'

/**
 * 조회 스토어가 쓰는 명령은 이 둘뿐이다(읽기 전용). ioredis `Redis`가 구조적으로
 * 만족하므로 그대로 넘길 수 있고, 테스트는 진짜 Redis에 위임하면서 읽기 사이에
 * 실제 쓰기를 끼워 넣는 얇은 래퍼를 넘겨 **재시도 경합을 재현**한다
 * (가짜 응답을 만들지 않는다 — 값은 전부 Redis에서 온다).
 */
export interface ReadOnlyRedis {
  hget(key: string, field: string): Promise<string | null>
  hgetall(key: string): Promise<Record<string, string>>
}

/** 조회 스냅샷. 생성 시점에 검증하고 동결한다. */
export interface GameScoreSnapshot {
  readonly roomId: string
  readonly gameId: string
  readonly phase: RoomPhase
  /** playerId → 점수판. **playerId 오름차순**이 곧 응답의 키 순서다. */
  readonly scoreboards: ReadonlyMap<string, ScoreBoard>
}

/** 조회 포트. */
export interface GameScoreQueryStore {
  findByRoomId(roomId: string, requesterId: string): Promise<GameScoreSnapshot>
}

/**
 * 읽기 재시도 횟수. 2회 모두 스냅샷이 어긋나면 `STORE_FAILURE`(500)다.
 * 조회는 락을 잡지 않는다: 게임 진행 경로가
 * 조회 때문에 멈추는 것이 스테일 응답보다 나쁘다.
 */
const MAX_READ_ATTEMPTS = 2

const ROOM_PHASES: ReadonlySet<string> = new Set(['LOBBY', 'PLAYING', 'FINISHED'])

const isBlank = (value: string | null | undefined): boolean => (value ?? '').trim().length === 0

const createSnapshot = (
  roomId: string,
  gameId: string,
  phase: RoomPhase,
  scoreboards: ReadonlyMap<string, ScoreBoard>,
): GameScoreSnapshot => {
  if (isBlank(roomId)) throw new GameQueryDomainError('roomId must not be blank')
  if (isBlank(gameId)) throw new GameQueryDomainError('gameId must not be blank')
  if (scoreboards.size === 0) throw new GameQueryDomainError('scoreboards must not be empty')
  return Object.freeze({ roomId, gameId, phase, scoreboards })
}

/**
 * Redis 조회 어댑터.
 *
 * **락 없는 읽기 → 검증 → 재시도**가 이 클래스의 전부다. 점수판은 플레이어마다
 * 다른 키에 있어 한 번에 읽을 수 없으므로, 다 읽은 뒤 gameId·phase·게임↔방
 * 역매핑·명단이 그대로인지 다시 확인하고 어긋났으면 통째로 다시 읽는다
 * (docs/design/game-modules.md 「조회 REST」).
 *
 * 쓰기 경로(`CONFIRM_SCORE` Lua)와 **같은 해시**를 읽으므로 매퍼도 점수 모듈의
 * `scoreBoardFromHash`를 그대로 쓴다 — 없는 카테고리 필드는 `null`(미기록),
 * 없는 메타 필드는 0이다.
 */
export class RedisGameScoreQueryStore implements GameScoreQueryStore {
  constructor(private readonly redis: ReadOnlyRedis) {}

  async findByRoomId(roomId: string, requesterId: string): Promise<GameScoreSnapshot> {
    // 빈 식별자의 이유 코드가 서로 다르다(404 vs 403) — 이 매핑이 계약이다.
    if (isBlank(roomId)) {
      throw new GameScoreQueryError('ROOM_NOT_FOUND', 'roomId must not be blank')
    }
    if (isBlank(requesterId)) {
      throw new GameScoreQueryError('PLAYER_NOT_IN_ROOM', 'requesterId must not be blank')
    }

    for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt += 1) {
      const snapshot = await this.readSnapshot(roomId, requesterId)
      if (await this.isStillCurrent(snapshot)) return snapshot
    }
    throw new GameScoreQueryError(
      'STORE_FAILURE',
      `게임 점수판을 일관된 상태로 조회하지 못했습니다: ${roomId}`,
    )
  }

  /** 한 번의 읽기. 검사 순서가 곧 오류 우선순위다(방 → 게임 시작 → phase → 매핑 → 참가). */
  private async readSnapshot(roomId: string, requesterId: string): Promise<GameScoreSnapshot> {
    const room = await this.redis.hgetall(roomKey(roomId))
    if (Object.keys(room).length === 0) {
      throw new GameScoreQueryError('ROOM_NOT_FOUND', `방을 찾을 수 없습니다: ${roomId}`)
    }

    const gameId = room.gameId ?? ''
    if (gameId.trim().length === 0) {
      throw new GameScoreQueryError('GAME_NOT_STARTED', `시작된 게임이 없습니다: ${roomId}`)
    }
    const phase = parsePhase(room.phase, roomId)
    await this.validateGameMapping(roomId, gameId)

    const players = await this.redis.hgetall(playersKey(roomId))
    if (!Object.hasOwn(players, requesterId)) {
      throw new GameScoreQueryError('PLAYER_NOT_IN_ROOM', `방 참가자가 아닙니다: ${requesterId}`)
    }

    const scoreboards = new Map<string, ScoreBoard>()
    for (const playerId of Object.keys(players).sort()) {
      scoreboards.set(playerId, await this.readScoreBoard(gameId, playerId))
    }

    try {
      return createSnapshot(roomId, gameId, phase, scoreboards)
    } catch (error) {
      if (error instanceof GameQueryDomainError) {
        throw new GameScoreQueryError('STORE_FAILURE', error.message, { cause: error })
      }
      throw error
    }
  }

  /**
   * 게임 → 방 역매핑 확인. 방 해시가 가리키는 게임이 정작 다른 방(또는 아무 방도)
   * 을 가리키면 **404 ROOM_NOT_FOUND**다 — 게임 키가 먼저 지워진 종료 직후의 창.
   */
  private async validateGameMapping(roomId: string, gameId: string): Promise<void> {
    const mappedRoom = await this.redis.hget(gameKey(gameId), 'roomCode')
    if (mappedRoom !== roomId) {
      throw new GameScoreQueryError(
        'ROOM_NOT_FOUND',
        `현재 방에 연결된 게임을 찾을 수 없습니다: ${roomId}`,
      )
    }
  }

  private async readScoreBoard(gameId: string, playerId: string): Promise<ScoreBoard> {
    return readScoreBoard(
      this.redis,
      gameId,
      playerId,
      (id, cause) =>
        new GameScoreQueryError('STORE_FAILURE', `Redis 점수판 값이 올바르지 않습니다: ${id}`, {
          cause,
        }),
    )
  }

  /**
   * 읽는 동안 gameId·phase·게임↔방 매핑·명단 중 하나라도 변했으면 이 스냅샷은
   * 버린다. 점수 **값**은 보지 않는다 — 확정된 점수만 늘어나므로 값이 바뀐 것은
   * 일관성 위반이 아니다(늦게 읽힌 사람이 한 턴 더 반영됐을 뿐).
   */
  private async isStillCurrent(snapshot: GameScoreSnapshot): Promise<boolean> {
    const key = roomKey(snapshot.roomId)
    const currentGameId = await this.redis.hget(key, 'gameId')
    const currentPhase = await this.redis.hget(key, 'phase')
    const currentRoom = await this.redis.hget(gameKey(snapshot.gameId), 'roomCode')
    const currentPlayers = Object.keys(await this.redis.hgetall(playersKey(snapshot.roomId))).sort()
    const readPlayers = [...snapshot.scoreboards.keys()]
    return (
      snapshot.gameId === currentGameId &&
      snapshot.phase === currentPhase &&
      snapshot.roomId === currentRoom &&
      currentPlayers.length === readPlayers.length &&
      currentPlayers.every((playerId, index) => playerId === readPlayers[index])
    )
  }
}

/** 알 수 없는 phase 값·누락은 500(STORE_FAILURE)이다. */
const parsePhase = (value: string | undefined, roomId: string): RoomPhase => {
  if (value === undefined || !ROOM_PHASES.has(value)) {
    throw new GameScoreQueryError('STORE_FAILURE', `방 상태가 올바르지 않습니다: ${roomId}`)
  }
  return value as RoomPhase
}
