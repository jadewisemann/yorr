import { randomUUID } from 'node:crypto'
import { DomainError } from '../../errors.js'
import { PING_PONG } from '../catalog.js'
import type { MatchArchiveInput } from '../match/index.js'
import { WIN_SCORE } from './pingPongRules.js'

/**
 * 로컬 AI 탁구 결과 보관.
 *
 * **멀티플레이 파이프라인과 완전히 분리된 경로다**(docs/design/games/pingpong.md).
 * 온디바이스 AI와의 싱글플레이는 서버가 판을 진행하지 않으므로 Redis 상태·스토어·
 * 모듈·완료 서비스가 전혀 개입하지 않고, 클라이언트가 끝난 결과만 REST로 보고한다.
 *
 * 그래서 DESIGN.md 원칙 1(서버 권위)을 여기서 지키는 방법은 하나뿐이다: **보고된
 * 점수를 규칙으로 다시 확인한다.** 서버가 랠리를 보지 못했으므로 "이 스코어라인이
 * 탁구 규칙으로 끝날 수 있는가"(11점·2점차)만 판정할 수 있고, 그것이 조작 방어의
 * 전부다 — 그 이상은 신뢰 경계 밖이다(아래 「재검증의 한계」).
 *
 * 3.4의 표면 중 쓰는 것은 {@link WIN_SCORE} 하나다.
 */

/** 방 없이 진행된 판의 `room_code` 자리. `matches.room_code`는 NOT NULL이다. */
export const LOCAL_AI_ROOM_CODE = 'LOCAL_AI'
/** AI 참가자의 `player_id`. users 테이블에 없으므로 `user_id`는 항상 NULL이 된다. */
export const AI_PLAYER_ID = 'ping-pong-ai'
export const AI_NICKNAME = 'AI'
/** 비로그인 보고자의 표시 이름(Java와 같은 문자열). */
export const GUEST_NICKNAME = '게스트'

/**
 * 결과를 남길 사람. `user/session.ts`의 `UserIdentity`가 **구조적으로 만족한다** —
 * 좁은 포트로 받아 `game/`이 `user/`를 import하지 않는다(3.4의 포트 방침과 같은 결).
 */
export interface PingPongAiPlayer {
  readonly userId: string
  readonly nickname: string
}

/**
 * 4.4 보관 서비스의 로컬 게임 진입점만 잘라낸 포트.
 * `MatchArchiveService`가 어댑터 없이 만족한다(`aiResultService.test.ts`가 고정).
 */
export interface PingPongAiResultArchive {
  archiveParticipants(input: MatchArchiveInput): Promise<boolean>
}

/**
 * 바인딩이 끝난 요청 본문. Java `PingPongAiResultRequest` record에 해당한다 —
 * 점수는 `int` primitive이므로 **빠지면 0**이고(그 값은 점수 재검증에서 걸린다),
 * `resultId`는 `String`이라 null일 수 있다.
 */
export interface PingPongAiResultRequest {
  readonly resultId: string | null | undefined
  readonly humanScore: number
  readonly aiScore: number
}

/**
 * 바인딩 결과. `ok: false`는 Spring의 `HttpMessageNotReadableException` 자리다 —
 * 도메인 오류 코드가 아니라 **읽을 수 없는 본문**이므로 코드 문자열이 없다.
 * `request: null`은 본문 자체가 없는 요청(`@RequestBody(required = false)` → null)이고,
 * 그 갈래는 서비스가 `invalid_ai_result`로 판정한다.
 */
export type PingPongAiResultBinding =
  | { readonly ok: true; readonly request: PingPongAiResultRequest | null }
  | { readonly ok: false }

/**
 * 원시 JSON → {@link PingPongAiResultRequest}. Jackson의 record 바인딩을 흉내낸다:
 *
 * - 필드가 없거나 null이면 primitive 기본값 **0**(3.4가 swing payload에서 쓴 관용과 같다).
 * - 정수 문자열(`"11"`)은 받는다 — Jackson의 String→int 강제 변환.
 * - 소수는 **버린다**(`11.9 → 11`) — Jackson `ACCEPT_FLOAT_AS_INT`가 기본 on이다.
 * - `resultId`가 문자열이 아니면 없는 것으로 본다 → `invalid_result_id`로 떨어진다.
 */
export const bindPingPongAiResult = (body: unknown): PingPongAiResultBinding => {
  if (body === undefined || body === null) return { ok: true, request: null }
  if (typeof body !== 'object' || Array.isArray(body)) return { ok: false }
  const raw = body as Record<string, unknown>
  const humanScore = bindInt(raw.humanScore)
  const aiScore = bindInt(raw.aiScore)
  if (humanScore === undefined || aiScore === undefined) return { ok: false }
  return {
    ok: true,
    request: {
      resultId: typeof raw.resultId === 'string' ? raw.resultId : undefined,
      humanScore,
      aiScore,
    },
  }
}

export class PingPongAiResultService {
  constructor(private readonly matches: PingPongAiResultArchive) {}

  /**
   * 세션이 있는 보고자(회원 **또는 게스트 세션**)의 결과.
   *
   * 회원/게스트를 여기서 가르지 않는 것이 계약이다 — 회원 판정은 4.4가 **users
   * 테이블 존재 여부**로 한다(`MatchArchiveService.save`). 로그인한 게스트도 자기
   * userId로 행이 남지만 `user_id`가 NULL이라 랭킹·전적 조회에는 오르지 않는다.
   */
  async archive(
    user: PingPongAiPlayer | null | undefined,
    request: PingPongAiResultRequest | null | undefined,
  ): Promise<boolean> {
    if (user == null || request == null) throw new DomainError('invalid_ai_result')
    return this.save(user.userId, user.nickname, request)
  }

  /**
   * 비로그인 보고자의 결과. **playerId를 임의 UUID로 만든다** — 세션이 없어
   * 이 사람을 가리킬 식별자가 아예 없다. users에 없는 값이므로 4.4가 `user_id`를
   * NULL로 적고, 그 행은 주간 랭킹 질의(`JOIN users` / `user_id IS NOT NULL`)에
   * 걸리지 않는다. 즉 **게스트의 회원 전적은 남지 않는다**.
   */
  async archiveGuest(request: PingPongAiResultRequest | null | undefined): Promise<boolean> {
    if (request == null) throw new DomainError('invalid_ai_result')
    return this.save(randomUUID(), GUEST_NICKNAME, request)
  }

  /**
   * 검증 순서가 계약이다: **resultId 먼저, 점수 나중**. 둘 다 틀린 요청은
   * `invalid_result_id`를 받는다(Java와 같다).
   *
   * @returns 실제로 저장했는지. 이미 보고된 `resultId`면 false다 — 실패가 아니라
   * 멱등이므로 REST는 그래도 204를 돌려준다(`game_id` UNIQUE가 중복을 막는다).
   */
  private async save(
    playerId: string,
    nickname: string,
    request: PingPongAiResultRequest,
  ): Promise<boolean> {
    const resultId = normalizeResultId(request.resultId)
    const { humanScore, aiScore } = request
    validateFinalScore(humanScore, aiScore)

    // 2점차 이상이 보장됐으므로 동점은 없다 — 1·2위가 항상 갈린다.
    const humanRank = humanScore > aiScore ? 1 : 2
    return this.matches.archiveParticipants({
      gameId: resultId,
      gameCode: PING_PONG,
      roomCode: LOCAL_AI_ROOM_CODE,
      participants: [
        { playerId, displayNickname: nickname, totalScore: humanScore, ranking: humanRank },
        {
          playerId: AI_PLAYER_ID,
          displayNickname: AI_NICKNAME,
          totalScore: aiScore,
          ranking: humanRank === 1 ? 2 : 1,
        },
      ],
    })
  }
}

/**
 * `resultId`는 **클라이언트가 만든 UUID**다(서버가 발급하지 않는다). 이 값이
 * `matches.game_id`가 되고 그 컬럼의 UNIQUE 제약이 재전송·새로고침으로 같은 판이
 * 두 번 쌓이는 것을 막는 유일한 장치다 — 그래서 모양을 여기서 못박는다.
 *
 * Java는 `UUID.fromString`의 `RuntimeException`(null이면 NPE 포함)을 통째로 잡아
 * `invalid_result_id`로 바꾼다. 같은 갈래를 정규식으로 만든다.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const normalizeResultId = (resultId: string | null | undefined): string => {
  const value = resultId ?? ''
  if (!UUID_PATTERN.test(value)) throw new DomainError('invalid_result_id')
  // Java `UUID.fromString(...).toString()`은 **소문자로 정규화**한다.
  return value.toLowerCase()
}

/**
 * 점수 재검증 — 서버가 이 판에서 볼 수 있는 것의 전부다.
 *
 * "탁구 규칙으로 **끝날 수 있는** 스코어라인인가"만 본다: 음수 없음 ·
 * 이긴 쪽이 {@link WIN_SCORE} 이상 · 2점차 이상.
 *
 * ### 재검증의 한계 (Java와 같은 구멍 — 그대로 이식했다)
 *
 * `11:0`처럼 실제로 가능한 값과 `50:3`·`12:9`처럼 **11점에서 이미 끝났어야 하는**
 * 값을 구분하지 못한다(듀스는 12:10·13:11…로 올라가므로 상한을 못박을 수 없고,
 * 듀스 구간의 정확한 조건은 "이긴 점수가 11이거나, 11 초과면 2점차 정확히"다).
 * 조용히 조이지 않는 이유: 와이어 계약 동결(ADR-0002)이고, 이 경로로 남는 점수는
 * `user_id`가 있어도 **주간 랭킹의 게임 코드 필터**를 통과하지 못하면 순위에
 * 영향이 없다. 조이려면 프론트가 보내는 값의 실측이 먼저다.
 */
const validateFinalScore = (humanScore: number, aiScore: number): void => {
  const winner = Math.max(humanScore, aiScore)
  if (humanScore < 0 || aiScore < 0 || winner < WIN_SCORE || Math.abs(humanScore - aiScore) < 2) {
    throw new DomainError('invalid_final_score')
  }
}

/** Jackson `int` 바인딩 흉내 — {@link bindPingPongAiResult} 참고. */
const bindInt = (value: unknown): number | undefined => {
  if (value === undefined || value === null) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : undefined
  if (typeof value === 'string' && /^[+-]?\d+$/.test(value.trim())) return Number(value.trim())
  return undefined
}
