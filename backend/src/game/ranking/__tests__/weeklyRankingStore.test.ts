import { randomUUID } from 'node:crypto'
import type { Pool, ResultSetHeader } from 'mysql2/promise'
import { expect, it } from 'vitest'
import { describeMysql, useMysql } from '../../../infra/__tests__/mysqlHarness.js'
import { runMigrations } from '../../../infra/migrations/runner.js'
import { YACHT_DICE } from '../../catalog.js'
import { weeklyRankingResponse } from '../weeklyRankingResponse.js'
import { MysqlWeeklyRankingStore } from '../weeklyRankingStore.js'

/**
 * 이식: (캐시 3종 제외 — 그건
 * 데코레이터 단위 테스트로 옮겼다, `weeklyRankingCache.test.ts`).
 *
 * 주간 집계 질의는 스키마와 함께 움직인다 — `user_id` nullable(게스트)과 users 조인,
 * GROUP BY의 합이 맞아야 한다. **그 합은 실제 MySQL에서만 확인된다.** 그래서 이
 * 파일은 ADR-0005의 게이트 뒤에 있다(`MYSQL_TEST_URL`이 없으면 통째로 skip).
 * 주 경계 환산·동점 번호·캐시는 게이트 **밖**에서 돈다.
 *
 * 시각은 `finished_at`과 같은 기준(UTC)으로 직접 넣는다. 풀의 `timezone: 'Z'`가
 * Date → DATETIME(6) 변환을 UTC로 못박아 준다(4.1).
 *
 * 전적 행은 4.4의 `MatchArchiveService`를 부르지 않고 SQL로 직접 넣는다 — 이 티켓이
 * 검증하려는 것은 **읽기 질의**이고, 쓰기 경로에 묶으면 4.4의 진행과 함께 깨진다.
 */

/** 2026-08-03(월) 00:00 KST == 2026-08-02(일) 15:00 UTC */
const FROM = new Date('2026-08-02T15:00:00.000Z')
const TO = new Date('2026-08-09T15:00:00.000Z')

const plusDays = (at: Date, days: number): Date =>
  new Date(at.getTime() + days * 24 * 60 * 60 * 1000)

describeMysql('MysqlWeeklyRankingStore (실 MySQL)', () => {
  const mysqlPool = useMysql()

  const store = async (): Promise<{ pool: Pool; store: MysqlWeeklyRankingStore }> => {
    const pool = mysqlPool()
    await runMigrations(pool)
    return { pool, store: new MysqlWeeklyRankingStore(pool) }
  }

  /** 회원 한 명. `users` 행이 있다는 것이 곧 "게스트가 아니다"의 정의다. */
  const saveUser = async (pool: Pool, nickname: string): Promise<string> => {
    const id = randomUUID()
    const at = new Date('2026-08-01T00:00:00.000Z')
    await pool.query(
      'INSERT INTO users (id, nickname, profile_image_url, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)',
      [id, nickname, at, at],
    )
    return id
  }

  /** 참가자 하나로 이루어진 판. 점수 외의 값은 이 질의가 보지 않으므로 최소한만 채운다. */
  const saveMatch = async (
    pool: Pool,
    options: {
      gameId: string
      gameCode?: string
      finishedAt: Date
      userId: string | null
      displayNickname: string
      score: number
    },
  ): Promise<void> => {
    const [inserted] = await pool.query<ResultSetHeader>(
      'INSERT INTO matches (game_id, game_code, room_code, player_count, finished_at) VALUES (?, ?, ?, ?, ?)',
      [options.gameId, options.gameCode ?? YACHT_DICE, 'ROOM01', 1, options.finishedAt],
    )
    await pool.query(
      `INSERT INTO match_participants
         (match_id, user_id, player_id, display_nickname, total_score, ranking)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [
        inserted.insertId,
        options.userId,
        options.userId ?? `guest-${options.gameId}`,
        options.displayNickname,
        options.score,
      ],
    )
  }

  /**
   * 게스트에게는 계정이 없으므로 랭킹에 오를 자리도 없다 — 점수가 아무리 높아도
   * 빠진다. 이 경계가 곧 로그인할 이유다.
   */
  it('게스트는 점수가 높아도 집계에서 빠진다', async () => {
    const { pool, store: rankings } = await store()
    const member = await saveUser(pool, '회원')
    await saveMatch(pool, {
      gameId: 'g-member',
      finishedAt: FROM,
      userId: member,
      displayNickname: '회원',
      score: 200,
    })
    await saveMatch(pool, {
      gameId: 'g-guest',
      finishedAt: FROM,
      userId: null,
      displayNickname: '손님',
      score: 900,
    })

    expect(await rankings.findWeeklyBest(YACHT_DICE, FROM, TO, 100)).toEqual([
      { userId: member, nickname: '회원', bestScore: 200 },
    ])
  })

  /** 주간 최고점은 누적이 아니라 **한 판의 최댓값**이다. */
  it('여러 판을 해도 한 판 최고점만 센다', async () => {
    const { pool, store: rankings } = await store()
    const member = await saveUser(pool, '회원')
    for (const [index, score] of [200, 320, 180].entries()) {
      await saveMatch(pool, {
        gameId: `g-${index}`,
        finishedAt: plusDays(FROM, index),
        userId: member,
        displayNickname: '회원',
        score,
      })
    }

    const rows = await rankings.findWeeklyBest(YACHT_DICE, FROM, TO, 100)

    expect(rows.map((row) => row.bestScore)).toEqual([320])
  })

  /** 시작은 포함, 끝은 제외다. 경계를 잘못 잡으면 한 판이 두 주에 세어진다. */
  it('기간 밖의 판은 세지 않는다', async () => {
    const { pool, store: rankings } = await store()
    const member = await saveUser(pool, '회원')
    // DATETIME(6)이라 1마이크로초 차이도 남는다 — 1밀리초로 확인한다.
    await saveMatch(pool, {
      gameId: 'g-before',
      finishedAt: new Date(FROM.getTime() - 1),
      userId: member,
      displayNickname: '회원',
      score: 900,
    })
    await saveMatch(pool, {
      gameId: 'g-start',
      finishedAt: FROM,
      userId: member,
      displayNickname: '회원',
      score: 100,
    })
    await saveMatch(pool, {
      gameId: 'g-end',
      finishedAt: TO,
      userId: member,
      displayNickname: '회원',
      score: 800,
    })

    const rows = await rankings.findWeeklyBest(YACHT_DICE, FROM, TO, 100)

    expect(rows.map((row) => row.bestScore)).toEqual([100])
  })

  /**
   * 닉네임은 **현재 프로필 이름**이어야 한다. `display_nickname`은 그때 그 화면에
   * 보였던 이름이라, 이름을 바꾼 회원이 랭킹에서 옛 이름으로 보이면 안 된다.
   */
  it('닉네임은 지난 판의 표시 이름이 아니라 현재 프로필 이름이다', async () => {
    const { pool, store: rankings } = await store()
    const member = await saveUser(pool, '바꾼이름')
    await saveMatch(pool, {
      gameId: 'g-1',
      finishedAt: FROM,
      userId: member,
      displayNickname: '그때쓴이름',
      score: 200,
    })

    const rows = await rankings.findWeeklyBest(YACHT_DICE, FROM, TO, 100)

    expect(rows.map((row) => row.nickname)).toEqual(['바꾼이름'])
  })

  it('점수 내림차순으로 나온다', async () => {
    const { pool, store: rankings } = await store()
    const low = await saveUser(pool, '하위')
    const high = await saveUser(pool, '상위')
    await saveMatch(pool, {
      gameId: 'g-low',
      finishedAt: FROM,
      userId: low,
      displayNickname: '하위',
      score: 100,
    })
    await saveMatch(pool, {
      gameId: 'g-high',
      finishedAt: FROM,
      userId: high,
      displayNickname: '상위',
      score: 300,
    })

    const rows = await rankings.findWeeklyBest(YACHT_DICE, FROM, TO, 100)

    expect(rows.map((row) => row.nickname)).toEqual(['상위', '하위'])
  })

  /** limit은 상위 몇 명까지만 자른다 — 정렬이 먼저다. */
  it('limit이 목록을 자른다', async () => {
    const { pool, store: rankings } = await store()
    for (const [index, score] of [100, 300, 200].entries()) {
      const user = await saveUser(pool, `회원${index}`)
      await saveMatch(pool, {
        gameId: `g-${index}`,
        finishedAt: FROM,
        userId: user,
        displayNickname: `회원${index}`,
        score,
      })
    }

    const rows = await rankings.findWeeklyBest(YACHT_DICE, FROM, TO, 2)

    expect(rows.map((row) => row.bestScore)).toEqual([300, 200])
  })

  /**
   * 내 순위는 "나보다 점수가 높은 회원 수 + 1"이다. 동점자는 같은 번호를 받으므로
   * 목록에 적히는 번호와 반드시 일치해야 한다 — 두 값이 갈리면 같은 사람이 화면
   * 두 곳에서 다른 순위로 보인다.
   */
  it('내 순위는 목록에 적히는 번호와 같다', async () => {
    const { pool, store: rankings } = await store()
    const top = await saveUser(pool, '일등')
    const tieA = await saveUser(pool, '공동이등가')
    const tieB = await saveUser(pool, '공동이등나')
    const me = await saveUser(pool, '나')
    for (const [gameId, userId, nickname, score] of [
      ['g-top', top, '일등', 300],
      ['g-tie-a', tieA, '공동이등가', 250],
      ['g-tie-b', tieB, '공동이등나', 250],
      ['g-me', me, '나', 100],
    ] as const) {
      await saveMatch(pool, {
        gameId,
        finishedAt: FROM,
        userId,
        displayNickname: nickname,
        score,
      })
    }

    const entries = weeklyRankingResponse({
      weekStart: '2026-08-03',
      rows: await rankings.findWeeklyBest(YACHT_DICE, FROM, TO, 100),
    }).entries

    // 번호는 1, 2, 2, 4다. 동점자 둘의 앞뒤는 user_id(UUID) 순이라 삽입 순서와
    // 무관하므로 이름까지 못 박지 않는다 — 여기서 보려는 것은 번호 체계다.
    expect(entries.map((entry) => entry.rank)).toEqual([1, 2, 2, 4])
    expect(
      [...entries]
        .map((entry) => [entry.nickname, entry.rank] as const)
        .sort((left, right) => left[0].localeCompare(right[0])),
    ).toEqual(
      [
        ['일등', 1],
        ['공동이등가', 2],
        ['공동이등나', 2],
        ['나', 4],
      ].sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    )
    expect(await rankings.findWeeklyBestScoreOf(me, YACHT_DICE, FROM, TO)).toBe(100)
    expect((await rankings.countMembersScoringMoreThan(100, YACHT_DICE, FROM, TO)) + 1).toBe(4)
  })

  /** 여러 판을 했으면 그중 최고점이 내 점수다 — 마지막 판이 아니다. */
  it('내 최고점은 여러 판 중 최댓값이다', async () => {
    const { pool, store: rankings } = await store()
    const me = await saveUser(pool, '나')
    for (const [index, score] of [120, 260, 80].entries()) {
      await saveMatch(pool, {
        gameId: `g-${index}`,
        finishedAt: plusDays(FROM, index),
        userId: me,
        displayNickname: '나',
        score,
      })
    }

    expect(await rankings.findWeeklyBestScoreOf(me, YACHT_DICE, FROM, TO)).toBe(260)
  })

  it('요트다이스 기록 없이 탁구나 결투 기록만 있으면 랭킹에 나타나지 않는다', async () => {
    const { pool, store: rankings } = await store()
    const pingPongPlayer = await saveUser(pool, '탁구회원')
    const duelPlayer = await saveUser(pool, '결투회원')
    await saveMatch(pool, {
      gameId: 'ping-pong',
      gameCode: 'PING_PONG',
      finishedAt: FROM,
      userId: pingPongPlayer,
      displayNickname: '탁구회원',
      score: 11,
    })
    await saveMatch(pool, {
      gameId: 'duel',
      gameCode: 'DUEL',
      finishedAt: FROM,
      userId: duelPlayer,
      displayNickname: '결투회원',
      score: 3,
    })

    expect(await rankings.findWeeklyBest(YACHT_DICE, FROM, TO, 100)).toEqual([])
    expect(
      await rankings.findWeeklyBestScoreOf(pingPongPlayer, YACHT_DICE, FROM, TO),
    ).toBeUndefined()
    expect(await rankings.findWeeklyBestScoreOf(duelPlayer, YACHT_DICE, FROM, TO)).toBeUndefined()
  })

  /** 기록 없음은 0점과 다르다 — undefined여야 "오를 자리가 없다"를 표현할 수 있다. */
  it('이번 주 기록이 없으면 최고점이 undefined다', async () => {
    const { pool, store: rankings } = await store()
    const me = await saveUser(pool, '나')
    await saveMatch(pool, {
      gameId: 'g-last-week',
      finishedAt: plusDays(FROM, -3),
      userId: me,
      displayNickname: '나',
      score: 500,
    })

    expect(await rankings.findWeeklyBestScoreOf(me, YACHT_DICE, FROM, TO)).toBeUndefined()
  })

  /** 0점 기록은 있는 것이다 — MAX가 0을 돌려주면 undefined로 접히면 안 된다. */
  it('0점 기록은 0으로 돌아온다(undefined가 아니다)', async () => {
    const { pool, store: rankings } = await store()
    const me = await saveUser(pool, '나')
    await saveMatch(pool, {
      gameId: 'g-zero',
      finishedAt: FROM,
      userId: me,
      displayNickname: '나',
      score: 0,
    })

    expect(await rankings.findWeeklyBestScoreOf(me, YACHT_DICE, FROM, TO)).toBe(0)
  })

  /** 한 회원이 여러 판에서 넘겼어도 한 번만 센다(DISTINCT). */
  it('나보다 잘한 회원은 중복 없이 센다', async () => {
    const { pool, store: rankings } = await store()
    const rival = await saveUser(pool, '라이벌')
    for (const [index, score] of [300, 400].entries()) {
      await saveMatch(pool, {
        gameId: `g-rival-${index}`,
        finishedAt: FROM,
        userId: rival,
        displayNickname: '라이벌',
        score,
      })
    }
    await saveMatch(pool, {
      gameId: 'g-guest',
      finishedAt: FROM,
      userId: null,
      displayNickname: '손님',
      score: 900,
    })

    // 게스트는 세지 않는다 — 900점이어도 순위에 없으므로 내 앞에 서지 못한다.
    expect(await rankings.countMembersScoringMoreThan(100, YACHT_DICE, FROM, TO)).toBe(1)
  })

  /** 동점은 "나보다 높은"이 아니다 — 초과(`>`)만 세는 것이 1,2,2,4를 만든다. */
  it('동점자는 나보다 잘한 사람으로 세지 않는다', async () => {
    const { pool, store: rankings } = await store()
    const tie = await saveUser(pool, '동점자')
    await saveMatch(pool, {
      gameId: 'g-tie',
      finishedAt: FROM,
      userId: tie,
      displayNickname: '동점자',
      score: 250,
    })

    expect(await rankings.countMembersScoringMoreThan(250, YACHT_DICE, FROM, TO)).toBe(0)
  })
})
