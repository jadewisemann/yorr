/**
 * 결투 한 판의 전체 상태 — backend-java `game/duel/DuelState`.
 *
 * 방마다 하나씩 Redis에 직렬화되어 살아 있고, **그대로 WebSocket으로도 나간다**
 * (`game.duel.state`의 payload는 래핑 없이 이 객체다). 화면은 이 값만 보고 그린다.
 *
 * 진영 번호를 두지 않고 playerId를 키로 쓴다 — "나를 왼쪽에 두는" 좌우 배치는
 * 화면의 몫이라 서버는 순서(`playerOrder`)만 알려준다.
 *
 * 와이어 정본은 `frontend/src/realtime/wsEvents.ts`의 `DuelState`·`DuelRound`다.
 * null 취급이 두 갈래인 것도 Java 그대로다:
 * - `lastRound`는 **생략**된다(Java `@JsonInclude(NON_NULL)`이 DuelState에만 붙어
 *   있다) → `undefined`로 두면 `JSON.stringify`가 지운다.
 * - `lastRound` **안의** shooterId·hitId·koId·foulId는 애노테이션이 없는 중첩
 *   레코드라 `null`이 그대로 실린다 → 여기서도 `null`을 쓴다.
 */
export type DuelPhase =
  /** 신호등 빨강 — 여기서 뽑으면 부정출발이다. */
  | 'WAITING'
  /** 신호등 초록 — 뽑는 순간이 기록된다. */
  | 'SIGNAL'
  /** 판정 연출 중. */
  | 'RESULT'
  | 'FINISHED'

/** 라운드 성격 — 규칙 근거는 `duelRules.ts` 주석에 있다. */
export type DuelRoundKind =
  /** 정상 승부 — 더 빨리 뽑은 쪽이 상대를 쐈다. */
  | 'SHOT'
  /** 1ms까지 동일하거나 둘 다 놓쳤다 — 체력 변화 없음. */
  | 'TIE'
  /** 부정출발 1회차 — 라운드 무효 + 경고 적립. */
  | 'WARNING'
  /** 경고가 차서 자기 발을 쐈다 — 본인 체력 -1, 남은 총알과 무관하게 패배. */
  | 'SELF_SHOT'
  /** 상대가 방을 떠났다. */
  | 'FORFEIT'

/**
 * 직전 라운드 판정. 화면의 연출(총알 방향·피격·쓰러짐)이 전부 이 한 줄에서 나온다.
 * hp·fouls는 이미 판정이 반영된 값이므로, 총알이 닿기 전 프레임은 화면이 되돌려 그린다.
 */
export interface DuelRound {
  readonly number: number
  readonly kind: DuelRoundKind
  /** 상대를 쏜 쪽. TIE·부정출발 라운드에는 없다. */
  readonly shooterId: string | null
  /** 체력을 잃은 쪽. self-shot이면 부정출발한 본인이다. */
  readonly hitId: string | null
  readonly koId: string | null
  readonly foulId: string | null
  readonly over: boolean
  readonly at: number
}

/** playerId → 값. Java `Map<String, Integer>` 자리(JSON 객체로 직렬화된다). */
export type DuelPlayerNumbers = Readonly<Record<string, number>>

export interface DuelState {
  /** 모든 변이마다 +1. 스케줄러 키이자 스토어의 갱신 판정 기준이다. */
  readonly version: number
  readonly phase: DuelPhase
  readonly playerOrder: readonly string[]
  /** 남은 총알. 0이 되면 쓰러진다. **종료 시 점수가 이 값이다.** */
  readonly hp: DuelPlayerNumbers
  /** 쌓인 부정출발 경고. 라운드를 넘어 누적되고 리셋되지 않는다. */
  readonly fouls: DuelPlayerNumbers
  /** 이번 라운드의 반응 시간(ms). FOUL·MISS 센티넬이 섞여 들어온다. 라운드마다 비운다. */
  readonly reactions: DuelPlayerNumbers
  readonly lastInputSeq: DuelPlayerNumbers
  readonly round: number
  /** 신호등이 초록으로 바뀐 서버 시각. 0이면 아직 빨강이다. */
  readonly signalAt: number
  readonly nextActionAt: number
  /** 없으면 **필드 자체가 생략**된다(NON_NULL). */
  readonly lastRound?: DuelRound | undefined
}

export const isDuelFinished = (state: DuelState): boolean => state.phase === 'FINISHED'
