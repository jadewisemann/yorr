import type { Redis } from 'ioredis'
import { expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../../test/redisHarness.js'
import {
  gameKey,
  gameScoreboardKey,
  gameScoreSubmissionsKey,
  playersKey,
  roomKey,
  scoresKey,
} from '../../../room/keys.js'
import {
  InMemoryRoundStateStore,
  RoundState,
  RoundSubmission,
  type RoundSubmissionResult,
} from '../../round/index.js'
import type { ScoreBoard } from '../scoreBoard.js'
import { RedisScoreBoardStore } from '../scoreBoardStore.js'
import { ScoreConfirmationService } from '../scoreConfirmationService.js'
import { isScoreConfirmationError, type ScoreConfirmationReason } from '../scoreErrors.js'
import {
  type RoundSubmitPayloadLike,
  type RoundSubmitPort,
  ScoreRoundSubmissionService,
} from '../scoreRoundSubmissionService.js'

const ROOM_CODE = 'ROOM1'
const GAME_ID = 'game-1'
const PLAYER_ID = 'player-1'

/**
 * **진짜 Redis**에서만
 * 의미가 있는 것들(Lua 원자성·멱등 재시도·동시 요청·TTL·양방향 매핑)만 여기 둔다.
 */
describeRedis('RedisScoreBoardStore', () => {
  const redis = useRedis()

  const service = (): ScoreConfirmationService =>
    new ScoreConfirmationService(new RedisScoreBoardStore(redis()))

  const createPlayingGame = async (gameId: string): Promise<void> => {
    const client: Redis = redis()
    await client.hset(gameKey(gameId), 'roomCode', ROOM_CODE)
    await client.hset(roomKey(ROOM_CODE), 'gameId', gameId, 'phase', 'PLAYING')
    await client.hset(playersKey(ROOM_CODE), PLAYER_ID, 'player')
    await client.hset(scoresKey(ROOM_CODE), PLAYER_ID, '0')
  }

  const confirm = async (
    gameId: string,
    roundNumber: number,
    category: string,
    ...dice: number[]
  ) => service().confirm({ gameId, playerId: PLAYER_ID, roundNumber, category, dice })

  const expectReason = async (
    operation: () => Promise<unknown>,
    reason: ScoreConfirmationReason,
  ): Promise<void> => {
    let thrown: unknown
    try {
      await operation()
    } catch (error) {
      thrown = error
    }
    expect(isScoreConfirmationError(thrown, reason)).toBe(true)
  }

  const roomTotal = async (): Promise<string | null> =>
    redis().hget(scoresKey(ROOM_CODE), PLAYER_ID)

  const setUp = async (): Promise<void> => {
    await createPlayingGame(GAME_ID)
  }

  it('실제 Redis에 점수를 확정한다', async () => {
    await setUp()

    const result = await confirm(GAME_ID, 1, 'choice', 1, 2, 3, 4, 5)

    expect(result.score).toBe(15)
    expect(result.scoreboard.categories.choice).toBe(15)
    expect(result.scoreboard.total).toBe(15)
    expect(await redis().hget(gameScoreboardKey(GAME_ID, PLAYER_ID), 'choice')).toBe('15')
  })

  it('확정된 0점과 미제출 칸을 구분한다', async () => {
    await setUp()

    const { scoreboard } = await confirm(GAME_ID, 1, 'yacht', 1, 2, 3, 4, 5)

    expect(scoreboard.categories.yacht).toBe(0)
    expect(scoreboard.categories.ones).toBeNull()
    expect(await redis().hexists(gameScoreboardKey(GAME_ID, PLAYER_ID), 'yacht')).toBe(1)
    expect(await redis().hexists(gameScoreboardKey(GAME_ID, PLAYER_ID), 'ones')).toBe(0)
  })

  it('같은 요청의 재시도는 점수를 두 번 더하지 않는다', async () => {
    await setUp()
    await confirm(GAME_ID, 1, 'choice', 1, 2, 3, 4, 5)

    const { scoreboard } = await confirm(GAME_ID, 1, 'choice', 1, 2, 3, 4, 5)

    expect(scoreboard.total).toBe(15)
    expect(await roomTotal()).toBe('15')
    expect(await redis().hlen(gameScoreSubmissionsKey(GAME_ID, PLAYER_ID))).toBe(1)
  })

  it('같은 라운드의 다른 요청은 거부한다', async () => {
    await setUp()
    await confirm(GAME_ID, 1, 'choice', 1, 2, 3, 4, 5)

    await expectReason(() => confirm(GAME_ID, 1, 'yacht', 6, 6, 6, 6, 6), 'ROUND_ALREADY_SCORED')
    expect(await roomTotal()).toBe('15')
  })

  /** 시그니처가 주사위 순서에 민감하다는 quirk의 회귀 테스트. */
  it('주사위 순서만 다른 재시도는 멱등이 아니라 거부다', async () => {
    await setUp()
    await confirm(GAME_ID, 1, 'choice', 1, 2, 3, 4, 5)

    await expectReason(() => confirm(GAME_ID, 1, 'choice', 5, 4, 3, 2, 1), 'ROUND_ALREADY_SCORED')
    expect(await roomTotal()).toBe('15')
  })

  it('다른 라운드에서 같은 카테고리를 다시 쓰면 거부한다', async () => {
    await setUp()
    await confirm(GAME_ID, 1, 'choice', 1, 2, 3, 4, 5)

    await expectReason(() => confirm(GAME_ID, 2, 'choice', 6, 6, 6, 6, 6), 'CATEGORY_ALREADY_USED')
    expect(await roomTotal()).toBe('15')
  })

  it('동시에 들어온 같은 요청 16건은 한 번만 반영된다', async () => {
    await setUp()

    const results = await Promise.all(
      Array.from({ length: 16 }, () => confirm(GAME_ID, 1, 'choice', 1, 2, 3, 4, 5)),
    )

    for (const result of results) {
      expect(result.scoreboard.total).toBe(15)
    }
    expect(await roomTotal()).toBe('15')
    expect(await redis().hlen(gameScoreSubmissionsKey(GAME_ID, PLAYER_ID))).toBe(1)
  })

  it('상단 소계가 63에 닿는 순간 보너스 35를 준다', async () => {
    await setUp()
    await confirm(GAME_ID, 1, 'ones', 1, 1, 1, 2, 3)
    await confirm(GAME_ID, 2, 'twos', 2, 2, 2, 1, 3)
    await confirm(GAME_ID, 3, 'threes', 3, 3, 3, 1, 2)
    await confirm(GAME_ID, 4, 'fours', 4, 4, 4, 1, 2)
    await confirm(GAME_ID, 5, 'fives', 5, 5, 5, 1, 2)

    const { scoreboard } = await confirm(GAME_ID, 6, 'sixes', 6, 6, 6, 1, 2)

    expect(scoreboard.upperSubtotal).toBe(63)
    expect(scoreboard.upperBonus).toBe(35)
    expect(scoreboard.total).toBe(98)
    expect(await roomTotal()).toBe('98')
  })

  /** 보너스가 이미 지급된 뒤의 상단 기록이 보너스를 또 얹지 않는지. */
  it('보너스는 한 번만 얹힌다', async () => {
    await setUp()
    await confirm(GAME_ID, 1, 'twos', 2, 2, 2, 1, 3)
    await confirm(GAME_ID, 2, 'threes', 3, 3, 3, 1, 2)
    await confirm(GAME_ID, 3, 'fours', 4, 4, 4, 1, 2)
    await confirm(GAME_ID, 4, 'fives', 5, 5, 5, 1, 2)
    await confirm(GAME_ID, 5, 'sixes', 6, 6, 6, 1, 2)
    // 소계 60 → 보너스 없음
    expect((await confirm(GAME_ID, 6, 'choice', 1, 1, 1, 1, 1)).scoreboard.upperBonus).toBe(0)

    const { scoreboard } = await confirm(GAME_ID, 7, 'ones', 1, 1, 1, 2, 3)

    expect(scoreboard.upperSubtotal).toBe(63)
    expect(scoreboard.upperBonus).toBe(35)
    expect(scoreboard.total).toBe(60 + 3 + 5 + 35)
    expect(await roomTotal()).toBe(String(scoreboard.total))
  })

  it('점수판 총점과 방 누적 총점이 같다', async () => {
    await setUp()

    const { scoreboard } = await confirm(GAME_ID, 1, 'fullHouse', 3, 3, 3, 5, 5)

    expect(scoreboard.total).toBe(19)
    expect(await roomTotal()).toBe(String(scoreboard.total))
  })

  it('스테일 게임 매핑은 현재 방 점수를 바꾸지 못한다', async () => {
    await setUp()
    const staleGameId = 'game-stale'
    await redis().hset(gameKey(staleGameId), 'roomCode', ROOM_CODE)

    await expectReason(() => confirm(staleGameId, 1, 'choice', 1, 2, 3, 4, 5), 'GAME_NOT_FOUND')

    expect(await roomTotal()).toBe('0')
    expect(await redis().hgetall(gameScoreboardKey(staleGameId, PLAYER_ID))).toEqual({})
    expect(await redis().hgetall(gameScoreSubmissionsKey(staleGameId, PLAYER_ID))).toEqual({})
  })

  it('PLAYING이 아닌 방은 GAME_NOT_ACTIVE다', async () => {
    await setUp()
    await redis().hset(roomKey(ROOM_CODE), 'phase', 'FINISHED')

    await expectReason(() => confirm(GAME_ID, 1, 'choice', 1, 2, 3, 4, 5), 'GAME_NOT_ACTIVE')
    expect(await roomTotal()).toBe('0')
  })

  it('roster에 없는 플레이어는 PLAYER_NOT_IN_GAME이다', async () => {
    await setUp()
    await redis().hdel(playersKey(ROOM_CODE), PLAYER_ID)

    await expectReason(() => confirm(GAME_ID, 1, 'choice', 1, 2, 3, 4, 5), 'PLAYER_NOT_IN_GAME')
  })

  it('게임 키가 없으면 GAME_NOT_FOUND다', async () => {
    await setUp()

    await expectReason(() => confirm('game-missing', 1, 'choice', 1, 2, 3, 4, 5), 'GAME_NOT_FOUND')
  })

  it('점수판·제출 이력 TTL을 게임 키에 맞춘다', async () => {
    await setUp()
    await redis().pexpire(gameKey(GAME_ID), 60_000)

    await confirm(GAME_ID, 1, 'choice', 1, 2, 3, 4, 5)

    expect(await redis().pttl(gameScoreboardKey(GAME_ID, PLAYER_ID))).toBeGreaterThan(0)
    expect(await redis().pttl(gameScoreSubmissionsKey(GAME_ID, PLAYER_ID))).toBeGreaterThan(0)
  })

  // ── 라운드 제출과의 원자 결합 ────────────────────────────────────────────
  const submitter = (store: InMemoryRoundStateStore): RoundSubmitPort<RoundSubmissionResult> => ({
    submit: async (roomId, playerId, payload, beforeStateChange) =>
      store.submitAtomically(
        roomId,
        new RoundSubmission(playerId, payload.roundNumber, payload.dice, payload.category),
        beforeStateChange,
      ),
  })

  const startedRoundStore = async (): Promise<InMemoryRoundStateStore> => {
    const store = new InMemoryRoundStateStore()
    await store.initialize(ROOM_CODE, RoundState.start(1, [PLAYER_ID]))
    await store.recordRollAtomically(
      ROOM_CODE,
      PLAYER_ID,
      1,
      1,
      [false, false, false, false, false],
      [1, 2, 3, 4, 5],
    )
    return store
  }

  const roundPayload = (): RoundSubmitPayloadLike => ({
    roundNumber: 1,
    dice: [1, 2, 3, 4, 5],
    category: 'choice',
  })

  it('실제 Redis 실패는 라운드 제출을 커밋하지 않는다', async () => {
    await setUp()
    const staleGameId = 'game-stale'
    await redis().hset(gameKey(staleGameId), 'roomCode', ROOM_CODE)
    const roundStore = await startedRoundStore()
    const coordinator = new ScoreRoundSubmissionService(submitter(roundStore), service(), {
      getSnapshot: async () => ({ gameId: staleGameId }),
    })

    await expectReason(
      () => coordinator.submit(ROOM_CODE, PLAYER_ID, roundPayload()),
      'GAME_NOT_FOUND',
    )

    const state = await roundStore.findByRoomId(ROOM_CODE)
    expect(state?.roundNumber).toBe(1)
    expect(state?.submittedPlayerIds).toEqual([])
    expect(await roomTotal()).toBe('0')
  })

  it('실제 Redis 성공은 라운드 완료 전에 점수를 커밋한다', async () => {
    await setUp()
    const roundStore = await startedRoundStore()
    const coordinator = new ScoreRoundSubmissionService(submitter(roundStore), service(), {
      getSnapshot: async () => ({ gameId: GAME_ID }),
    })

    const result = await coordinator.submit(ROOM_CODE, PLAYER_ID, roundPayload())

    const scoreboard: ScoreBoard | undefined = result.score?.scoreboard
    expect(scoreboard?.total).toBe(15)
    expect(result.round.completedRound).not.toBeNull()
    expect(await roomTotal()).toBe('15')
    const state = await roundStore.findByRoomId(ROOM_CODE)
    expect(state?.roundNumber).toBe(2)
    expect(state?.submittedPlayerIds).toEqual([])
  })
})
