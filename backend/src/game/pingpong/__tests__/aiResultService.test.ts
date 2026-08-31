import { describe, expect, it } from 'vitest'
import { DomainError } from '../../../errors.js'
import { PING_PONG } from '../../catalog.js'
import type { MatchArchiveInput, MatchArchiveStore, MatchRecord } from '../../match/index.js'
import { MatchArchiveService } from '../../match/index.js'
import {
  AI_NICKNAME,
  AI_PLAYER_ID,
  bindPingPongAiResult,
  GUEST_NICKNAME,
  LOCAL_AI_ROOM_CODE,
  type PingPongAiPlayer,
  type PingPongAiResultArchive,
  type PingPongAiResultRequest,
  PingPongAiResultService,
} from '../aiResultService.js'

/**
 * 이식: 전부(불가능 점수 3종 · UUID 검증)
 * + Java 테스트가 모킹으로 넘긴 **보관 인자**까지 실제로 본다.
 *
 * MySQL은 이 환경에 없으므로 보관 포트를 기록용 가짜로 바꿔 끼운다. 이 티켓에서
 * 조용히 틀릴 수 있는 것은 저장소가 아니라 **점수 재검증·UUID·게스트/회원 분기**이고,
 * 셋 다 MySQL 없이 여기서 전부 돈다(실 MySQL 절반은 `aiResultArchive.test.ts`).
 */

const RESULT_ID = 'e848355a-78a1-4297-a492-754a124c6b16'
const member: PingPongAiPlayer = { userId: 'member-1', nickname: '회원' }

const request = (overrides: Partial<PingPongAiResultRequest> = {}): PingPongAiResultRequest => ({
  resultId: RESULT_ID,
  humanScore: 11,
  aiScore: 7,
  ...overrides,
})

class RecordingArchive implements PingPongAiResultArchive {
  readonly inputs: MatchArchiveInput[] = []
  saved = true

  async archiveParticipants(input: MatchArchiveInput): Promise<boolean> {
    this.inputs.push(input)
    return this.saved
  }
}

const setUp = (): { archive: RecordingArchive; service: PingPongAiResultService } => {
  const archive = new RecordingArchive()
  return { archive, service: new PingPongAiResultService(archive) }
}

describe('PingPongAiResultService — 점수 재검증', () => {
  /**
   * 
   *
   * 서버가 랠리를 보지 못하는 경로이므로 이 판정이 조작 방어의 전부다
   * (DESIGN.md 원칙 1 — 클라이언트가 보낸 점수를 그대로 믿지 않는다).
   */
  it.each([
    { humanScore: 10, aiScore: 7, why: '이긴 쪽이 11점에 못 미친다' },
    { humanScore: 11, aiScore: 10, why: '2점차가 아니다' },
    { humanScore: -1, aiScore: 11, why: '음수 점수' },
  ])('$why → invalid_final_score', async ({ humanScore, aiScore }) => {
    const { archive, service } = setUp()

    await expect(service.archive(member, request({ humanScore, aiScore }))).rejects.toThrow(
      new DomainError('invalid_final_score'),
    )
    // 거절된 판은 보관 경로로 내려가지 않는다.
    expect(archive.inputs).toEqual([])
  })

  it.each([
    { humanScore: 11, aiScore: 0 },
    { humanScore: 11, aiScore: 9 },
    { humanScore: 9, aiScore: 11 },
    { humanScore: 13, aiScore: 11 },
  ])('규칙으로 끝날 수 있는 $humanScore:$aiScore는 통과한다', async ({ humanScore, aiScore }) => {
    const { archive, service } = setUp()

    await expect(service.archive(member, request({ humanScore, aiScore }))).resolves.toBe(true)
    expect(archive.inputs).toHaveLength(1)
  })

  /**
   * Java와 **같은 구멍**이다: 11점에서 이미 끝났어야 하는 스코어라인을 막지 못한다.
   * 조용히 조이지 않고 재현한 뒤 문서에 적었다(마이그레이션 규칙 — 동작 차이는
   * 기록하고 결정한다).
   */
  it('11점에서 끝났어야 하는 점수도 통과한다 (Java와 같은 재검증의 한계)', async () => {
    const { service } = setUp()

    await expect(service.archive(member, request({ humanScore: 50, aiScore: 3 }))).resolves.toBe(
      true,
    )
    await expect(service.archive(member, request({ humanScore: 12, aiScore: 9 }))).resolves.toBe(
      true,
    )
  })

  it('사람이 지면 1위가 AI다', async () => {
    const { archive, service } = setUp()

    await service.archive(member, request({ humanScore: 6, aiScore: 11 }))

    expect(archive.inputs[0]?.participants).toEqual([
      { playerId: 'member-1', displayNickname: '회원', totalScore: 6, ranking: 2 },
      { playerId: AI_PLAYER_ID, displayNickname: AI_NICKNAME, totalScore: 11, ranking: 1 },
    ])
  })
})

describe('PingPongAiResultService — resultId', () => {
  /** */
  it.each(['not-a-uuid', '', 'e848355a78a14297a492754a124c6b16', `${RESULT_ID} `])(
    'UUID가 아닌 %j는 invalid_result_id다',
    async (resultId) => {
      const { archive, service } = setUp()

      await expect(service.archive(member, request({ resultId }))).rejects.toThrow(
        new DomainError('invalid_result_id'),
      )
      expect(archive.inputs).toEqual([])
    },
  )

  it('resultId가 없으면 invalid_result_id다 (Java의 UUID.fromString(null) 갈래)', async () => {
    const { service } = setUp()

    await expect(service.archive(member, request({ resultId: null }))).rejects.toThrow(
      new DomainError('invalid_result_id'),
    )
  })

  /**
   * 검증 **순서**가 계약이다 — Java는 `normalizeResultId`를 먼저 부르므로 둘 다 틀린
   * 요청은 점수 오류가 아니라 ID 오류를 받는다.
   */
  it('ID와 점수가 함께 틀리면 invalid_result_id가 먼저다', async () => {
    const { service } = setUp()

    await expect(
      service.archive(member, { resultId: 'nope', humanScore: 3, aiScore: 2 }),
    ).rejects.toThrow(new DomainError('invalid_result_id'))
  })

  /** Java `UUID.fromString(...).toString()`은 소문자로 정규화한다. */
  it('대문자 UUID는 소문자로 정규화해 저장한다', async () => {
    const { archive, service } = setUp()

    await service.archive(member, request({ resultId: RESULT_ID.toUpperCase() }))

    expect(archive.inputs[0]?.gameId).toBe(RESULT_ID)
  })

  /**
   * `resultId`가 그대로 `matches.game_id`가 되고 그 UNIQUE 제약이 중복 보고를 막는다 —
   * 서버가 발급하지 않는 값이므로 이 대입이 끊기면 멱등이 사라진다.
   */
  it('resultId를 gameId 자리에 그대로 넘긴다', async () => {
    const { archive, service } = setUp()

    await service.archive(member, request())

    expect(archive.inputs[0]).toMatchObject({
      gameId: RESULT_ID,
      gameCode: PING_PONG,
      roomCode: LOCAL_AI_ROOM_CODE,
    })
  })

  /** 이미 보고된 판이면 보관은 false를 돌려주지만 그것은 실패가 아니다. */
  it('중복 판이면 false를 그대로 돌려준다', async () => {
    const { archive, service } = setUp()
    archive.saved = false

    await expect(service.archive(member, request())).resolves.toBe(false)
  })
})

describe('PingPongAiResultService — 게스트/회원 분기', () => {
  it('세션이 있으면 그 userId·닉네임으로 남긴다', async () => {
    const { archive, service } = setUp()

    await service.archive({ userId: 'member-1', nickname: '회원' }, request())

    expect(archive.inputs[0]?.participants[0]).toEqual({
      playerId: 'member-1',
      displayNickname: '회원',
      totalScore: 11,
      ranking: 1,
    })
  })

  /**
   * 
   *
   * 서비스는 회원과 게스트 세션을 **가르지 않는다** — 회원 판정은 4.4가 users
   * 테이블 존재 여부로 한다. 여기서 타입으로 가르면 세션이 만료된 회원의 전적이
   * 주인을 잃는다(`matchArchiveStore.ts`의 계약).
   */
  it('게스트 세션도 자기 userId로 남긴다', async () => {
    const { archive, service } = setUp()

    await service.archive({ userId: 'guest-1', nickname: '손님' }, request())

    expect(archive.inputs[0]?.participants[0]).toMatchObject({
      playerId: 'guest-1',
      displayNickname: '손님',
    })
  })

  /**
   * 비로그인 보고자는 가리킬 식별자가 없으므로 임의 UUID를 만든다. users에 없는
   * 값이라 4.4가 `user_id`를 NULL로 적고 → 주간 랭킹 질의(`JOIN users`)에 걸리지
   * 않는다. 즉 **게스트의 회원 전적은 남지 않는다**.
   */
  it('세션이 없으면 매번 새 UUID를 playerId로 쓰고 이름은 "게스트"다', async () => {
    const { archive, service } = setUp()

    await service.archiveGuest(request())
    await service.archiveGuest(request({ resultId: '4b72f136-f3c2-49c9-bfdb-290891fd8638' }))

    const [first, second] = archive.inputs.map((input) => input.participants[0])
    expect(first?.displayNickname).toBe(GUEST_NICKNAME)
    expect(first?.playerId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(second?.playerId).not.toBe(first?.playerId)
  })

  it('AI는 언제나 고정 식별자·닉네임으로 들어간다', async () => {
    const { archive, service } = setUp()

    await service.archiveGuest(request())

    expect(archive.inputs[0]?.participants[1]).toEqual({
      playerId: AI_PLAYER_ID,
      displayNickname: AI_NICKNAME,
      totalScore: 7,
      ranking: 2,
    })
  })

  it.each([
    { label: '보고자가 없으면', run: (s: PingPongAiResultService) => s.archive(null, request()) },
    { label: '본문이 없으면', run: (s: PingPongAiResultService) => s.archive(member, null) },
    { label: '게스트 본문이 없으면', run: (s: PingPongAiResultService) => s.archiveGuest(null) },
  ])('$label invalid_ai_result다', async ({ run }) => {
    const { archive, service } = setUp()

    await expect(run(service)).rejects.toThrow(new DomainError('invalid_ai_result'))
    expect(archive.inputs).toEqual([])
  })
})

describe('bindPingPongAiResult — Jackson record 바인딩 흉내', () => {
  it('본문이 없으면 request가 null이다 (@RequestBody(required = false))', () => {
    expect(bindPingPongAiResult(undefined)).toEqual({ ok: true, request: null })
    expect(bindPingPongAiResult(null)).toEqual({ ok: true, request: null })
  })

  /** 3.4의 swing payload와 같은 관용 — primitive 기본값 0이 점수 재검증에서 걸린다. */
  it('점수가 빠지면 0이다', () => {
    expect(bindPingPongAiResult({ resultId: RESULT_ID })).toEqual({
      ok: true,
      request: { resultId: RESULT_ID, humanScore: 0, aiScore: 0 },
    })
  })

  it('정수 문자열은 받고 소수는 버린다', () => {
    expect(bindPingPongAiResult({ resultId: RESULT_ID, humanScore: '11', aiScore: 7.9 })).toEqual({
      ok: true,
      request: { resultId: RESULT_ID, humanScore: 11, aiScore: 7 },
    })
  })

  it('resultId가 문자열이 아니면 없는 것으로 본다', () => {
    expect(bindPingPongAiResult({ resultId: 42, humanScore: 11, aiScore: 7 })).toEqual({
      ok: true,
      request: { resultId: undefined, humanScore: 11, aiScore: 7 },
    })
  })

  it.each([
    { body: { humanScore: 'abc' }, why: '숫자가 아닌 문자열' },
    { body: { humanScore: true }, why: '불리언' },
    { body: { aiScore: Number.NaN }, why: 'NaN' },
    { body: { humanScore: {} }, why: '객체' },
    { body: [1, 2], why: '배열' },
    { body: 'plain', why: '객체가 아닌 본문' },
  ])('$why는 바인딩 실패다', ({ body }) => {
    expect(bindPingPongAiResult(body)).toEqual({ ok: false })
  })
})

/**
 * 4.4의 보관 서비스가 좁은 포트를 **어댑터 없이** 구조적으로 만족하는지. 타입만
 * 보는 것이 아니라 포트 변수를 통해 실제로 호출해 인자가 끝까지 도착하는지 본다.
 */
describe('PingPongAiResultArchive ↔ MatchArchiveService', () => {
  it('MatchArchiveService를 그대로 대입할 수 있다', async () => {
    const records: MatchRecord[] = []
    const store: MatchArchiveStore = {
      findMemberNicknames: async () => new Map<string, string>(),
      insert: async (record) => {
        records.push(record)
        return true
      },
    }
    const port: PingPongAiResultArchive = new MatchArchiveService(store)

    await expect(new PingPongAiResultService(port).archiveGuest(request())).resolves.toBe(true)

    expect(records[0]).toMatchObject({
      gameId: RESULT_ID,
      gameCode: PING_PONG,
      roomCode: LOCAL_AI_ROOM_CODE,
    })
    // 회원 조회에 걸리지 않은 두 참가자 모두 user_id가 NULL이다.
    expect(records[0]?.participants.map((row) => row.userId)).toEqual([null, null])
    expect(records[0]?.participants.map((row) => row.displayNickname)).toEqual([
      GUEST_NICKNAME,
      AI_NICKNAME,
    ])
  })
})
