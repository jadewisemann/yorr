import { beforeEach, describe, expect, it } from 'vitest'
import type { CompletionRoomSnapshot, MatchArchivePort, Ranking } from '../../completion/index.js'
import {
  DISPLAY_NICKNAME_LIMIT,
  FALLBACK_NICKNAME,
  MatchArchiveService,
  resolveDisplayNickname,
} from '../matchArchiveService.js'
import type { MatchArchiveStore, MatchRecord } from '../matchArchiveStore.js'

/**
 * 전적 보관 4종.
 *
 * **이 환경에는 MySQL이 없을 수 있다**(ADR-0005의 게이트). 그래서
 * `user/__tests__/profile.test.ts`와 같은 방식으로 같은 4종을 두 벌 적는다:
 *
 * 1. 이 파일 — 인메모리 저장소. **항상 돈다.** 멱등 판정·닉네임 우선순위·회원/게스트
 *    분기·시계 주입이 여기서 고정된다. 실제로 틀리는 로직이 전부 여기 있다.
 * 2. `matchArchiveStore.test.ts` — 실 MySQL. 스키마·제약(`game_id` UNIQUE,
 *    `user_id` nullable + FK)과 `finished_at`의 UTC 벽시계가 거기서만 확인된다.
 */

/** `matches`·`match_participants`·`users`를 대신하는 인메모리 저장소. */
class FakeMatchArchiveStore implements MatchArchiveStore {
  readonly records: MatchRecord[] = []
  /** playerId → 프로필 닉네임. 여기 있는 사람만 회원이다. */
  private readonly users = new Map<string, string>()
  lookups = 0

  seedMember(id: string, nickname: string): string {
    this.users.set(id, nickname)
    return id
  }

  async findMemberNicknames(playerIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    this.lookups += 1
    const found = new Map<string, string>()
    for (const playerId of playerIds) {
      const nickname = this.users.get(playerId)
      if (nickname !== undefined) found.set(playerId, nickname)
    }
    return found
  }

  async insert(record: MatchRecord): Promise<boolean> {
    if (this.records.some((stored) => stored.gameId === record.gameId)) return false
    this.records.push(record)
    return true
  }

  only(): MatchRecord {
    const [record] = this.records
    if (record === undefined || this.records.length !== 1) {
      throw new Error(`판이 정확히 하나여야 한다: ${this.records.length}`)
    }
    return record
  }
}

const GAME_ID = 'game-1'
const FIXED_NOW = new Date('2026-08-14T02:03:04.005Z')

const room = (
  players: readonly { playerId: string; nickname: string }[],
): CompletionRoomSnapshot => ({
  roomCode: 'ROOM01',
  gameCode: 'YACHT_DICE',
  gameId: GAME_ID,
  players: players.map((player) => ({ ...player, kind: 'HUMAN' })),
})

const ranking = (rank: number, playerId: string, total: number): Ranking => ({
  rank,
  playerId,
  total,
})

describe('MatchArchiveService (인메모리 저장소)', () => {
  let store: FakeMatchArchiveStore
  let evictions: number
  let archived: { gameId: string; roomCode: string; playerCount: number }[]
  let duplicates: string[]
  let service: MatchArchiveService

  beforeEach(() => {
    store = new FakeMatchArchiveStore()
    evictions = 0
    archived = []
    duplicates = []
    service = new MatchArchiveService(store, {
      now: () => FIXED_NOW,
      rankingCache: {
        invalidateAll: () => {
          evictions += 1
        },
      },
      onArchived: (event) => archived.push(event),
      onDuplicate: (gameId) => duplicates.push(gameId),
    })
  })

  // --- 보관 기본 4종 ---

  /** 회원과 게스트가 한 판에 섞여 있다. 판 자체는 온전히 남고, 주인이 있는 행에만 계정이 붙는다. */
  it('회원은_계정에_게스트는_이름만_남는다', async () => {
    const member = store.seedMember('member-1', '카카오회원')

    const saved = await service.archive(
      room([
        { playerId: member, nickname: '방에서쓴이름' },
        { playerId: 'guest-1', nickname: '지나가던손님' },
      ]),
      [ranking(1, member, 210), ranking(2, 'guest-1', 180)],
    )

    expect(saved).toBe(true)
    const stored = store.only()
    expect(stored.gameId).toBe(GAME_ID)
    expect(stored.gameCode).toBe('YACHT_DICE')
    expect(stored.roomCode).toBe('ROOM01')
    // player_count는 참가자 수에서 나온다 — 따로 세다 어긋나는 일이 없어야 한다.
    expect(stored.participants).toHaveLength(2)
    expect(stored.participants[0]).toEqual({
      playerId: member,
      userId: member,
      // 그때 화면에 보였던 이름이어야 한다 — 프로필 닉네임이 아니라 방에서 쓴 이름이다.
      displayNickname: '방에서쓴이름',
      totalScore: 210,
      ranking: 1,
    })
    expect(stored.participants[1]).toEqual({
      playerId: 'guest-1',
      userId: null,
      displayNickname: '지나가던손님',
      totalScore: 180,
      ranking: 2,
    })
  })

  /** 종료 방송이 두 번 일어나도 같은 판이 두 번 쌓이면 안 된다. */
  it('같은_게임은_한_번만_저장된다', async () => {
    const snapshot = room([{ playerId: 'guest-1', nickname: '손님' }])
    const rankings = [ranking(1, 'guest-1', 100)]

    expect(await service.archive(snapshot, rankings)).toBe(true)
    expect(await service.archive(snapshot, rankings)).toBe(false)

    expect(store.records).toHaveLength(1)
    expect(archived).toEqual([{ gameId: GAME_ID, roomCode: 'ROOM01', playerCount: 1 }])
    expect(duplicates).toEqual([GAME_ID])
  })

  /** 저장할 것이 없는 호출은 빈 판을 만들지 않는다. */
  it('순위가_비었으면_저장하지_않는다', async () => {
    expect(await service.archive(room([]), [])).toBe(false)

    expect(store.records).toHaveLength(0)
    // 저장할 것이 없으면 users 조회조차 하지 않는다(게임 중 MySQL 왕복 0회).
    expect(store.lookups).toBe(0)
  })

  /**
   * 닉네임을 방 스냅샷에서 못 찾는 경우가 있다 — 게임이 끝나기 전에 나간 사람이다.
   * 그래도 회원이면 프로필 이름으로, 아니면 식별자로라도 남긴다.
   */
  it('방에_없는_참가자도_이름을_찾아_남긴다', async () => {
    const member = store.seedMember('member-1', '떠난회원')

    await service.archive(room([]), [ranking(1, member, 150), ranking(2, 'guest-gone', 90)])

    const stored = store.only()
    expect(stored.participants[0]?.displayNickname).toBe('떠난회원')
    expect(stored.participants[0]?.userId).toBe(member)
    expect(stored.participants[1]?.displayNickname).toBe('guest-gone')
    expect(stored.participants[1]?.userId).toBeNull()
  })

  // --- Node 계약을 고정하는 추가 케이스 ---

  /** 2.7이 채울 자리를 어댑터 없이 채운다 — 배선은 상수 하나를 바꾸는 것뿐이어야 한다. */
  it('MatchArchivePort를 구조적으로 만족한다', async () => {
    const port: MatchArchivePort = service

    await port.archive(room([{ playerId: 'guest-1', nickname: '손님' }]), [
      ranking(1, 'guest-1', 10),
    ])

    expect(store.only().participants[0]?.playerId).toBe('guest-1')
  })

  it('finished_at은 주입된 시계 그대로다(UTC 벽시계로 저장된다)', async () => {
    await service.archive(room([{ playerId: 'guest-1', nickname: '손님' }]), [
      ranking(1, 'guest-1', 10),
    ])

    expect(store.only().finishedAt).toEqual(FIXED_NOW)
    expect(store.only().finishedAt.toISOString()).toBe('2026-08-14T02:03:04.005Z')
  })

  it('시계를 주입하지 않으면 현재 시각을 쓴다', async () => {
    const before = Date.now()
    const withDefaultClock = new MatchArchiveService(store)

    await withDefaultClock.archive(room([{ playerId: 'guest-1', nickname: '손님' }]), [
      ranking(1, 'guest-1', 10),
    ])

    const finishedAt = store.only().finishedAt.getTime()
    expect(finishedAt).toBeGreaterThanOrEqual(before)
    expect(finishedAt).toBeLessThanOrEqual(Date.now())
  })

  it('gameId·gameCode·roomCode가 공백이면 저장하지 않는다', async () => {
    expect(await service.archive({ ...room([]), gameId: null }, [ranking(1, 'g', 1)])).toBe(false)
    expect(await service.archive({ ...room([]), gameId: '  ' }, [ranking(1, 'g', 1)])).toBe(false)
    expect(await service.archive({ ...room([]), gameCode: null }, [ranking(1, 'g', 1)])).toBe(false)
    expect(await service.archive({ ...room([]), roomCode: null }, [ranking(1, 'g', 1)])).toBe(false)
    expect(await service.archive(null, [ranking(1, 'g', 1)])).toBe(false)
    expect(await service.archive(room([]), null)).toBe(false)

    expect(store.records).toHaveLength(0)
  })

  it('20자를 넘는 이름은 잘라서라도 남긴다', async () => {
    const long = '가'.repeat(30)

    await service.archive(room([{ playerId: 'guest-1', nickname: long }]), [
      ranking(1, 'guest-1', 10),
    ])

    expect(store.only().participants[0]?.displayNickname).toBe('가'.repeat(DISPLAY_NICKNAME_LIMIT))
  })

  it('셋 다 비면 "플레이어"로 남는다', () => {
    expect(resolveDisplayNickname(null, null, '   ')).toBe(FALLBACK_NICKNAME)
    expect(resolveDisplayNickname('  ', undefined, '\t')).toBe(FALLBACK_NICKNAME)
    // 우선순위: 방 이름 → 프로필 → playerId
    expect(resolveDisplayNickname('방', '프로필', 'pid')).toBe('방')
    expect(resolveDisplayNickname(' ', '프로필', 'pid')).toBe('프로필')
    expect(resolveDisplayNickname(null, '  ', 'pid')).toBe('pid')
  })

  /** playerId는 클라이언트가 고르는 값이 아니지만, 저장소가 Map이라 prototype 오염이 없다. */
  it('__proto__ 같은 playerId도 평범한 참가자로 다룬다', async () => {
    await service.archive(room([{ playerId: '__proto__', nickname: '수상한손님' }]), [
      ranking(1, '__proto__', 7),
    ])

    expect(store.only().participants[0]).toMatchObject({
      playerId: '__proto__',
      userId: null,
      displayNickname: '수상한손님',
    })
  })

  /** 같은 playerId가 방 명단에 두 번 있으면 먼저 온 이름을 쓴다. */
  it('중복 playerId는 방 명단의 첫 이름을 쓴다', async () => {
    await service.archive(
      room([
        { playerId: 'guest-1', nickname: '첫이름' },
        { playerId: 'guest-1', nickname: '나중이름' },
      ]),
      [ranking(1, 'guest-1', 10)],
    )

    expect(store.only().participants[0]?.displayNickname).toBe('첫이름')
  })

  /** 중복 판·검증 실패에도 캐시를 비운다. */
  it('랭킹 캐시는 중복 보관·빈 호출에도 비워진다', async () => {
    const snapshot = room([{ playerId: 'guest-1', nickname: '손님' }])
    const rankings = [ranking(1, 'guest-1', 100)]

    await service.archive(snapshot, rankings)
    await service.archive(snapshot, rankings)
    await service.archive(room([]), [])
    await service.archiveParticipants({
      gameId: 'local-1',
      gameCode: 'PING_PONG',
      roomCode: 'LOCAL_AI',
      participants: [{ playerId: 'guest-1', totalScore: 11, ranking: 1 }],
    })

    expect(evictions).toBe(4)
  })

  it('캐시 무효화가 실패해도 보관 결과는 그대로다', async () => {
    const brittle = new MatchArchiveService(store, {
      rankingCache: {
        invalidateAll: () => {
          throw new Error('캐시가 터졌다')
        },
      },
    })

    await expect(
      brittle.archive(room([{ playerId: 'guest-1', nickname: '손님' }]), [
        ranking(1, 'guest-1', 10),
      ]),
    ).resolves.toBe(true)
    expect(store.records).toHaveLength(1)
  })

  /**
   * 실패를 삼키는 것은 **종료 서비스의 책임**이다(2.7의 `onArchiveFailure`).
   * 보관이 조용히 false를 돌려주면 저장되지 않은 판이 아무 흔적 없이 사라진다.
   */
  it('저장소 오류는 삼키지 않고 던진다', async () => {
    const failing = new MatchArchiveService({
      findMemberNicknames: async () => new Map(),
      insert: async () => {
        throw new Error('mysql down')
      },
    })

    await expect(
      failing.archive(room([{ playerId: 'guest-1', nickname: '손님' }]), [
        ranking(1, 'guest-1', 1),
      ]),
    ).rejects.toThrow('mysql down')
  })

  /** 방 없이 진행된 로컬 게임(탁구 AI)도 같은 규칙을 쓴다. */
  it('archiveParticipants는 방 없이도 같은 규칙으로 저장한다', async () => {
    const member = store.seedMember('member-1', '탁구회원')

    const saved = await service.archiveParticipants({
      gameId: 'local-1',
      gameCode: 'PING_PONG',
      roomCode: 'LOCAL_AI',
      participants: [
        { playerId: member, totalScore: 11, ranking: 1 },
        { playerId: 'ping-pong-ai', displayNickname: 'AI', totalScore: 7, ranking: 2 },
      ],
    })

    expect(saved).toBe(true)
    const stored = store.only()
    expect(stored.gameCode).toBe('PING_PONG')
    expect(stored.roomCode).toBe('LOCAL_AI')
    expect(stored.participants[0]).toMatchObject({ userId: member, displayNickname: '탁구회원' })
    expect(stored.participants[1]).toMatchObject({ userId: null, displayNickname: 'AI' })
    expect(
      await service.archiveParticipants({
        gameId: 'local-1',
        gameCode: 'PING_PONG',
        roomCode: 'LOCAL_AI',
        participants: [{ playerId: member, totalScore: 11, ranking: 1 }],
      }),
    ).toBe(false)
  })
})
