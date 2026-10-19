import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadEnv } from '../../config/env.js'
import * as completionScripts from '../../game/completion/scripts.js'
import { DAVINCI_DECK_SIZE, initialDavinciState } from '../../game/davinci/davinciRules.js'
import { RedisDavinciStateStore } from '../../game/davinci/davinciStateStore.js'
import { initialDuelState } from '../../game/duel/duelRules.js'
import { RedisDuelStateStore } from '../../game/duel/duelStateStore.js'
import { SqliteMatchArchiveStore } from '../../game/match/matchArchiveStore.js'
import { initial as initialPingPong } from '../../game/pingpong/pingPongRules.js'
import { RedisPingPongStateStore } from '../../game/pingpong/pingPongStateStore.js'
import { SqliteWeeklyRankingStore } from '../../game/ranking/weeklyRankingStore.js'
import {
  InMemoryRoundStateStore,
  type RoundSubmissionResult,
  RoundSynchronizationService,
  seededDieRoller,
} from '../../game/round/index.js'
import { ScoreConfirmationService, ScoreRoundSubmissionService } from '../../game/score/index.js'
import * as scoreScripts from '../../game/score/scripts.js'
import { FakeRoundTimer, RecordingBroadcaster } from '../../game/yacht/__tests__/testDoubles.js'
import {
  AccumulatingScoreBoardStore,
  roomWith,
} from '../../game/yacht/bot/__tests__/botTestDoubles.js'
import { BotQueueFullError } from '../../game/yacht/bot/botErrors.js'
import type { YachtBotPolicy } from '../../game/yacht/bot/botPorts.js'
import { CooperativeYachtBotPolicy } from '../../game/yacht/bot/cooperativeBotPolicy.js'
import { ExpectimaxYachtBotPolicy } from '../../game/yacht/bot/expectimaxYachtBotPolicy.js'
import { LocalYachtBotStrategy } from '../../game/yacht/bot/localYachtBotStrategy.js'
import { ScorecardValueEvaluator } from '../../game/yacht/bot/scorecardValueEvaluator.js'
import { YachtBotTurnCoordinator } from '../../game/yacht/bot/yachtBotTurnCoordinator.js'
import { YachtTurnActionService } from '../../game/yacht/yachtTurnActionService.js'
import * as memoryRedisModule from '../../infra/memoryRedis.js'
import { type AtomicScript, MemoryRedis, OOM_MESSAGE } from '../../infra/memoryRedis.js'
import { createSqlitePool, type Pool, type PoolConnection } from '../../infra/sqlite.js'
import { loadStoreSnapshot, saveStoreSnapshot } from '../../infra/storeSnapshot.js'
import { gameStateKey } from '../../room/keys.js'
import { RoomService } from '../../room/roomService.js'
import * as roomScripts from '../../room/scripts.js'
import { createServer } from '../../server.js'

/**
 * PR #79 코드 리뷰 지적의 회귀 테스트 — SQLite가 티켓마다 `tkt-*.test`를 두듯, 지적 하나에
 * `describe` 하나다. 단위 테스트(`infra/__tests__/*`)가 각 수정의 정밀한 경계를 보고, 여기서는
 * **그 지적이 실제 모듈 조합에서 다시 일어나지 않는지**를 본다. 지적 번호는 PR 리뷰 순서다.
 * (지적 7은 봇 탐색 큐 PR에, 10은 브랜치 분리라 테스트 대상이 아니다.)
 */

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'yorr-pr79-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
const memory = (options?: ConstructorParameters<typeof MemoryRedis>[0]): MemoryRedis => {
  const redis = new MemoryRedis(options)
  cleanups.push(() => redis.disconnect())
  return redis
}
const settledWithin = <T>(promise: Promise<T>, ms: number): Promise<'settled' | 'stuck'> =>
  Promise.race([
    promise.then(
      () => 'settled' as const,
      () => 'settled' as const,
    ),
    new Promise<'stuck'>((resolve) => setTimeout(() => resolve('stuck'), ms)),
  ])

describe('지적 1 — COMMIT 실패 뒤에도 DB가 멈추지 않는다', () => {
  /**
   * SQLITE_FULL·IOERR로 COMMIT이 실패하면 SQLite는 스스로 되돌린다. 그 상황을 커넥션 대역으로
   * 만든다: commit이 진짜 ROLLBACK을 한 뒤 던진다. 예전에는 저장소의 rollback → release가 둘 다
   * "no transaction is active"로 던져 전역 잠금이 영원히 남았고, 그 뒤 랭킹·로그인이 전부 매달렸다.
   */
  const failingCommits = (pool: Pool): Pool => ({
    query: (sql, params) => pool.query(sql, params),
    end: () => pool.end(),
    getConnection: async (): Promise<PoolConnection> => {
      const conn = await pool.getConnection()
      return {
        query: (sql, params) => conn.query(sql, params),
        beginTransaction: () => conn.beginTransaction(),
        commit: async () => {
          await conn.query('ROLLBACK')
          throw Object.assign(new Error('database or disk is full'), { errcode: 13 })
        },
        rollback: () => conn.rollback(),
        release: () => conn.release(),
      }
    },
  })

  it('전적 보관이 COMMIT에서 실패해도 다음 랭킹 질의가 답한다', async () => {
    const pool = createSqlitePool(':memory:')
    cleanups.push(() => pool.end())
    const archive = new SqliteMatchArchiveStore(failingCommits(pool))
    const ranking = new SqliteWeeklyRankingStore(pool)

    await expect(
      archive.insert({
        gameId: 'game-1',
        gameCode: 'YACHT_DICE',
        roomCode: 'ROOM1',
        finishedAt: new Date('2026-10-19T00:00:00Z'),
        participants: [
          {
            playerId: 'guest-1',
            userId: null,
            displayNickname: '손님',
            totalScore: 10,
            ranking: 1,
          },
        ],
      }),
    ).rejects.toThrow(/disk is full/)

    const next = ranking.findWeeklyBest('YACHT_DICE', new Date(0), new Date(), 10)
    expect(await settledWithin(next, 2_000)).toBe('settled')
    await expect(next).resolves.toEqual([])
  })
})

describe('지적 2 — 엔진 하한이 node:sqlite와 맞는다', () => {
  const backendRoot = join(import.meta.dirname, '..', '..', '..')
  const packageJson = JSON.parse(readFileSync(join(backendRoot, 'package.json'), 'utf8')) as {
    engines: { node: string }
  }
  const lowerBound = (range: string): [number, number] => {
    const match = /^>=(\d+)\.(\d+)/.exec(range)
    if (match === null) throw new Error(`엔진 범위를 읽을 수 없다: ${range}`)
    return [Number(match[1]), Number(match[2])]
  }

  it('backend의 engines 하한이 22.13 이상이다(node:sqlite가 플래그 없이 도는 최소선)', () => {
    const [major, minor] = lowerBound(packageJson.engines.node)
    expect(major > 22 || (major === 22 && minor >= 13), packageJson.engines.node).toBe(true)
  })

  it('Botkeep 번들의 engines가 backend와 같다 — 둘이 갈라지면 한쪽만 거짓말한다', () => {
    const script = readFileSync(join(backendRoot, 'scripts', 'build-botkeep.mjs'), 'utf8')
    const bundled = /engines: \{ node: '([^']+)' \}/.exec(script)?.[1]
    expect(bundled).toBe(packageJson.engines.node)
  })

  it('지금 도는 Node가 그 하한을 만족한다', () => {
    const [major, minor] = lowerBound(packageJson.engines.node)
    const [runningMajor = 0, runningMinor = 0] = process.versions.node.split('.').map(Number)
    expect(runningMajor > major || (runningMajor === major && runningMinor >= minor)).toBe(true)
  })
})

describe('지적 3 — 게스트를 끝없이 만들어도 프로세스가 죽지 않는다', () => {
  it('상한에 닿으면 새 입장만 실패하고, 서버·헬스·기존 방은 그대로다', async () => {
    const redis = memory({ maxKeys: 40 })
    const server = await createServer(
      { ...loadEnv({ SQLITE_PATH: ':memory:' }), SERVER_PORT: 0 },
      { redis, logger: false },
    )
    cleanups.push(() => server.close())
    const enter = (body: Record<string, unknown>) =>
      server.app.inject({
        method: 'POST',
        url: '/api/v1/rooms?game_code=YACHT_DICE',
        payload: body,
      })

    const first = await enter({ nickname: '호스트' })
    expect(first.statusCode).toBe(200)
    const roomId = (first.json() as { room_id: string }).room_id

    const statuses: number[] = []
    for (let attempt = 0; attempt < 60; attempt += 1) {
      statuses.push((await enter({ nickname: `손님${attempt}` })).statusCode)
    }
    // 앞의 몇 번은 들어가고, 상한에 닿은 뒤로는 전부 5xx다. 프로세스는 살아 있다.
    expect(statuses.filter((status) => status === 200).length).toBeGreaterThan(0)
    expect(statuses.slice(-10).every((status) => status >= 500)).toBe(true)
    expect((await redis.keys()).length).toBeLessThanOrEqual(40)

    const health = await server.app.inject({ method: 'GET', url: '/actuator/health' })
    expect(health.statusCode).toBe(200)
    // 기존 방의 상태는 그대로 읽힌다.
    expect(await redis.hget(`room:${roomId}`, 'phase')).toBe('LOBBY')
  })

  it('키가 비면 다시 받는다(영구 고장이 아니다)', async () => {
    const redis = memory({ maxKeys: 2 })
    await redis.set('a', '1')
    await redis.set('b', '1')
    await expect(redis.set('c', '1')).rejects.toThrow(OOM_MESSAGE)
    await redis.del('a')
    await expect(redis.set('c', '1')).resolves.toBe('OK')
  })
})

const isAtomicScript = (value: unknown): value is AtomicScript =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as AtomicScript).run === 'function' &&
  typeof (value as AtomicScript).keys === 'number' &&
  typeof (value as AtomicScript).args === 'number'

/** 운영 스크립트 전부. 새 스크립트를 추가하면 여기 자동으로 들어온다. */
const ALL_SCRIPTS: readonly AtomicScript[] = [
  ...Object.values(roomScripts),
  ...Object.values(scoreScripts),
  ...Object.values(completionScripts),
  ...Object.values(memoryRedisModule),
].filter(isAtomicScript)

describe('지적 4 — 인자가 모자란 스크립트는 아무것도 바꾸지 않는다', () => {
  it('운영 스크립트가 빠짐없이 모였다', () => {
    expect(ALL_SCRIPTS.map((script) => script.name).sort()).toEqual(
      [
        'unlockIfOwner',
        'yorrGameConfirmScore',
        'yorrGameFinishIfComplete',
        'yorrRoomBotAdd',
        'yorrRoomBotRemove',
        'yorrRoomCancelActiveGame',
        'yorrRoomClose',
        'yorrRoomCreate',
        'yorrRoomJoin',
        'yorrRoomLeave',
        'yorrRoomReturnToLobby',
        'yorrRoomRollbackStart',
        'yorrRoomStart',
        'yorrRoomTouch',
      ].sort(),
    )
    for (const script of ALL_SCRIPTS) {
      expect(script.keys + script.args, script.name).toBeLessThanOrEqual(16)
      expect(script.keys, script.name).toBeLessThanOrEqual(8)
      expect(script.args, script.name).toBeLessThanOrEqual(8)
    }
  })

  /**
   * 살아 있는 방 하나를 깔아 두고, 모든 스크립트를 키·인자 하나 모자라게·하나 남게 부른다.
   * 예전에는 모자란 인자가 빈 문자열로 채워져 CREATE·TOUCH의 TTL `''`이 "지금 지워라"가 됐다.
   */
  for (const script of ALL_SCRIPTS) {
    it(`${script.name}: 개수가 틀리면 던지고 저장소가 그대로다`, async () => {
      const redis = memory()
      const rooms = new RoomService(redis)
      const roomCode = await rooms.createRoom(4, 'host', 'YACHT_DICE')
      await rooms.join(roomCode, { userId: 'host', nickname: '호스트' } as never)
      const before = redis.core.snapshot()
      const keys = Array.from({ length: script.keys }, () => `room:${roomCode}`)
      const args = Array.from({ length: script.args }, () => '60')

      // 하나 모자람·하나 남음을 키와 인자 각각에 대해. 0개에서 "하나 모자람"은 같은 모양이라 뺀다.
      const shapes: [string[], string[]][] = [
        [keys, args.slice(0, -1)],
        [keys, [...args, 'extra']],
        [keys.slice(0, -1), args],
        [[...keys, 'room:extra'], args],
      ]
      const wrongShapes = shapes.filter(
        ([wrongKeys, wrongArgs]) =>
          wrongKeys.length <= 8 &&
          wrongArgs.length <= 8 &&
          (wrongKeys.length !== script.keys || wrongArgs.length !== script.args),
      )
      expect(wrongShapes.length).toBeGreaterThanOrEqual(2)
      for (const [wrongKeys, wrongArgs] of wrongShapes) {
        await expect(
          redis.runAtomic(script, wrongKeys, wrongArgs),
          `keys=${wrongKeys.length} args=${wrongArgs.length}`,
        ).rejects.toThrow(/개가 필요한데/)
      }
      expect(redis.core.snapshot()).toEqual(before)
    })
  }

  it('TTL 자리에 빈 문자열이 오면 지우지 않고 던진다', async () => {
    const redis = memory()
    await redis.hset('room:X', 'phase', 'LOBBY')
    // 스크립트들은 방 키 가족의 TTL을 PEXPIRE로 맞춘다 — 두 경로 모두 막혀야 한다.
    for (const ttl of ['', ' ', '1.5', 'NaN']) {
      await expect(redis.expire('room:X', ttl), `EXPIRE ${JSON.stringify(ttl)}`).rejects.toThrow(
        /not an integer/,
      )
      await expect(redis.pexpire('room:X', ttl), `PEXPIRE ${JSON.stringify(ttl)}`).rejects.toThrow(
        /not an integer/,
      )
      await expect(
        redis.set('room:Y', 'v', 'PX', ttl),
        `SET PX ${JSON.stringify(ttl)}`,
      ).rejects.toThrow(/not an integer/)
    }
    expect(await redis.exists('room:X')).toBe(1)
    expect(await redis.pttl('room:X')).toBe(-1)
  })
})

describe('지적 5 — 범위를 넘는 음수 ZRANGE는 빈 목록이다', () => {
  it('3명 대기열에서 0..-5는 []다(예전에는 앞의 두 명을 돌려줬다)', async () => {
    const redis = memory()
    await redis.zadd('quick-match:queue:YACHT_DICE', 1, 'a', 2, 'b', 3, 'c')
    expect(await redis.zrange('quick-match:queue:YACHT_DICE', 0, -5)).toEqual([])
    expect(await redis.zrange('quick-match:queue:YACHT_DICE', -5, -3)).toEqual(['a'])
  })
})

describe('지적 6 — 열 수 없는 DB가 핸들을 새지 않는다', () => {
  it('손상된 DB 파일 위에서도 서버는 뜨고, 헬스는 DOWN이며, 질의를 거듭해도 fd가 늘지 않는다', async () => {
    const path = join(tempDir(), 'broken.db')
    writeFileSync(path, 'not a sqlite database '.repeat(500))
    const redis = memory()
    const server = await createServer(
      { ...loadEnv({ SQLITE_PATH: path }), SERVER_PORT: 0 },
      { redis, logger: false },
    )
    cleanups.push(() => server.close())

    const health = await server.app.inject({ method: 'GET', url: '/actuator/health' })
    expect(health.statusCode).toBe(503)

    const pool = createSqlitePool(path)
    cleanups.push(() => pool.end())
    await pool.query('SELECT 1').catch(() => {})
    const openFds = (): number => readdirSync('/proc/self/fd').length
    const before = openFds()
    for (let attempt = 0; attempt < 30; attempt += 1) await pool.query('SELECT 1').catch(() => {})
    expect(openFds()).toBeLessThanOrEqual(before)
  })
})

describe('지적 8 — 재시작이 저장소를 지우지 않는다', () => {
  it('손상된 스냅샷이어도 기동은 성공하고, 원본은 옆으로 치워진다', async () => {
    const dir = tempDir()
    const path = join(dir, 'store.json')
    writeFileSync(path, '{"version":1,"entries":[{"k":"x","t":"?"}]}')
    const redis = memory()
    expect(loadStoreSnapshot(redis, path, 7).kind).toBe('corrupt')
    const server = await createServer(
      { ...loadEnv({ SQLITE_PATH: ':memory:' }), SERVER_PORT: 0 },
      { redis, logger: false },
    )
    cleanups.push(() => server.close())
    await server.listen()
    expect(readdirSync(dir)).toEqual(['store.json.corrupt-7'])
  })

  it('방을 만든 서버의 저장소를 스냅샷하면 새 저장소에서 같은 방에 들어갈 수 있다', async () => {
    const path = join(tempDir(), 'store.json')
    const before = memory()
    const first = await createServer(
      { ...loadEnv({ SQLITE_PATH: ':memory:' }), SERVER_PORT: 0 },
      { redis: before, logger: false },
    )
    const created = await first.app.inject({
      method: 'POST',
      url: '/api/v1/rooms?game_code=YACHT_DICE',
      payload: { nickname: '호스트' },
    })
    const roomId = (created.json() as { room_id: string }).room_id
    await first.close()
    saveStoreSnapshot(before, path)

    const after = memory()
    expect(loadStoreSnapshot(after, path).kind).toBe('restored')
    const second = await createServer(
      { ...loadEnv({ SQLITE_PATH: ':memory:' }), SERVER_PORT: 0 },
      { redis: after, logger: false },
    )
    cleanups.push(() => second.close())
    const joined = await second.app.inject({
      method: 'POST',
      url: '/api/v1/rooms?game_code=YACHT_DICE',
      payload: { nickname: '손님', room_id: roomId },
    })
    expect(joined.statusCode).toBe(200)
  })
})

describe('지적 9 — 잠금 해제는 한 구현이고, 어느 저장소도 남의 잠금을 풀지 않는다', () => {
  const srcRoot = join(import.meta.dirname, '..', '..')
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path)
      return path.endsWith('.ts') ? [path] : []
    })

  it('토큰 비교 해제를 직접 구현한 곳은 infra/memoryRedis.ts 하나뿐이다', () => {
    const offenders = sourceFiles(srcRoot)
      .filter((path) => /\.get\(\w+\) === token/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(srcRoot, path))
    expect(offenders).toEqual(['infra/memoryRedis.ts'])
  })

  it('잠금을 쓰는 모듈은 전부 UNLOCK_IF_OWNER로 푼다', () => {
    const lockers = sourceFiles(srcRoot).filter((path) => {
      const source = readFileSync(path, 'utf8')
      return /:lock`/.test(source) || /LockKey\(/.test(source)
    })
    for (const path of lockers) {
      if (path.endsWith('keys.ts')) continue
      expect(readFileSync(path, 'utf8'), relative(srcRoot, path)).toContain('UNLOCK_IF_OWNER')
    }
  })

  /**
   * 내 작업 도중 TTL이 끝나 다른 요청이 잠금을 새로 잡은 상황을 만든다(변이 함수 안에서 잠금을
   * 남의 토큰으로 덮는다). 작업이 끝난 뒤에도 그 잠금이 남아 있어야 한다.
   */
  const stores = [
    {
      name: '결투',
      lockKey: `${gameStateKey('ROOM1', 'DUEL')}:lock`,
      run: async (redis: MemoryRedis, intrude: () => void) => {
        const store = new RedisDuelStateStore(redis)
        await store.initialize('ROOM1', initialDuelState(['p1', 'p2'], 1_000, 2_000))
        await store.mutate('ROOM1', (current) => {
          intrude()
          return { ...current, version: current.version + 1 }
        })
      },
    },
    {
      name: '다빈치',
      lockKey: `${gameStateKey('ROOM1', 'DAVINCI_CODE')}:lock`,
      run: async (redis: MemoryRedis, intrude: () => void) => {
        const store = new RedisDavinciStateStore(redis)
        const order = Array.from({ length: DAVINCI_DECK_SIZE }, (_, index) => index)
        await store.initialize('ROOM1', initialDavinciState(['p1', 'p2'], order, 1_000))
        await store.mutate('ROOM1', (current) => {
          intrude()
          return { ...current, version: current.version + 1 }
        })
      },
    },
    {
      name: '탁구',
      lockKey: `${gameStateKey('ROOM1', 'PING_PONG')}:lock`,
      run: async (redis: MemoryRedis, intrude: () => void) => {
        const store = new RedisPingPongStateStore(redis)
        await store.initialize('ROOM1', initialPingPong(['p1', 'p2'], 1_000))
        await store.mutate('ROOM1', (current) => {
          intrude()
          return { ...current, version: current.version + 1 }
        })
      },
    },
  ]

  for (const store of stores) {
    it(`${store.name} 상태 저장소는 작업 중 남이 잡은 잠금을 풀지 않는다`, async () => {
      const redis = memory()
      await store.run(redis, () => {
        redis.core.set(store.lockKey, 'intruder', 'PX', 5_000)
      })
      expect(await redis.get(store.lockKey)).toBe('intruder')
    })
  }
})

describe('지적 7 — 탐색이 몰려도 어느 방의 봇도 멈추지 않는다', () => {
  /**
   * 큐 하나를 여러 방이 공유한다(운영과 같다). 탐색 하나가 무겁게 걸리도록 느린 정책을 넣고 방
   * 여러 개를 동시에 굴린다. 상한을 넘은 탐색은 즉시 폴백으로 둬야 하고, 기다린 탐색은 그 사이
   * 바뀐 턴에 행동하면 안 된다 — 둘 중 하나라도 어긋나면 어떤 방은 12라운드를 끝내지 못한다.
   */
  it('방 6개 × 봇 2명이 큐 하나(상한 2)를 나눠 써도 전부 12라운드를 끝낸다', {
    timeout: 120_000,
  }, async () => {
    const busy = (ms: number): void => {
      const end = performance.now() + ms
      while (performance.now() < end) {}
    }
    const raw = new ExpectimaxYachtBotPolicy(new ScorecardValueEvaluator())
    const slow: YachtBotPolicy = {
      decide: (board, dice, rollCount) => {
        busy(5)
        return raw.decide(board, dice, rollCount)
      },
    }
    const shared = new CooperativeYachtBotPolicy(slow, undefined, 2)
    const fallbacks: unknown[] = []

    const playRoom = async (room: string, seed: number) => {
      const game = `game-${room}`
      const bots = ['bot-a', 'bot-b']
      const rounds = new RoundSynchronizationService(new InMemoryRoundStateStore(), {
        dieRoller: seededDieRoller(seed),
      })
      const scoreStore = new AccumulatingScoreBoardStore()
      const scores = new ScoreConfirmationService(scoreStore)
      const rooms = {
        getSnapshot: async () =>
          roomWith(
            game,
            bots.map((playerId) => ({ playerId, kind: 'BOT' as const })),
          ),
      }
      const submissions = new ScoreRoundSubmissionService<RoundSubmissionResult>(
        rounds,
        scores,
        rooms,
      )
      const actions = new YachtTurnActionService({
        rounds,
        timers: new FakeRoundTimer(),
        broadcaster: new RecordingBroadcaster(),
        submissions,
      })
      const coordinator = new YachtBotTurnCoordinator(
        { rounds, actions, policy: shared, strategy: new LocalYachtBotStrategy(), rooms, scores },
        { onPolicyFallback: (_roomId, _state, error) => fallbacks.push(error) },
      )
      await rounds.initialize(room, 1, bots)
      for (let steps = 0; steps < 300; steps += 1) {
        const state = await rounds.findByRoomId(room)
        if (state === undefined || state.finished) break
        await coordinator.playIfCurrent({ roomId: room, state })
      }
      const finished = await rounds.findByRoomId(room)
      const boards = await Promise.all(bots.map((botId) => scoreStore.findScoreBoard(game, botId)))
      return { finished, boards }
    }

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) => playRoom(`ROOM${index}`, 1000 + index)),
    )
    for (const [index, { finished, boards }] of results.entries()) {
      expect(finished?.finished, `ROOM${index}`).toBe(true)
      for (const board of boards) {
        expect(
          Object.values(board.categories).every((score) => score !== null),
          `ROOM${index}`,
        ).toBe(true)
      }
    }
    // 큐가 실제로 넘쳤고, 넘친 탐색은 폴백으로 처리됐다.
    expect(fallbacks.some((error) => error instanceof BotQueueFullError)).toBe(true)
    expect(shared.queued).toBe(0)
  })
})
