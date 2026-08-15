import { z } from 'zod'
import { RoundState, RoundSubmission } from '../round/index.js'

/**
 * Redis에 저장되는 야추 라운드 상태의 직렬화 모양.
 *
 * **재접속용 `YachtDiceState`와 다른 타입이다**(그쪽은 와이어, 이쪽은 저장소).
 * 필드 이름·순서는 저장 호환 계약이다: 이미 Redis에 있는 스냅샷을 읽을 수 있어야
 * 하므로 여기서 이름을 다듬으면 진행 중인 게임이 깨진다
 * (`room:{code}:game:YACHT_DICE:state`).
 *
 * `submissions`는 `RoundSubmission`을 그대로 펼친 모양
 * (`{playerId, roundNumber, dice, category}`)이다 — readonly 필드가
 * `JSON.stringify`에서 그 객체를 만든다.
 */
export interface YachtDiceStateSnapshot {
  readonly roundNumber: number
  readonly totalRounds: number
  readonly participantOrder: readonly string[]
  readonly submissions: Readonly<Record<string, YachtSubmissionSnapshot>>
  readonly activePlayerIndex: number
  readonly activeRollCount: number
  readonly activeDice: readonly number[] | null
  readonly activeHeld: readonly boolean[] | null
  readonly finished: boolean
}

interface YachtSubmissionSnapshot {
  readonly playerId: string
  readonly roundNumber: number
  readonly dice: readonly number[]
  readonly category: string
}

/**
 * 읽기 스키마. 저장소가 돌려준 JSON을 **구조 수준에서** 검증한다 — 값의 도메인
 * 유효성(주사위 범위·카테고리 이름·라운드 상한)은 `RoundSubmission`·`RoundState.restore`가
 * 다시 본다. 손상된 값을 조용히 통과시키지 않는 것이 목적이다 — 역직렬화 실패는
 * `invalid_yacht_state`로 수렴한다.
 */
const submissionSchema = z.object({
  playerId: z.string(),
  roundNumber: z.number(),
  dice: z.array(z.number()),
  category: z.string(),
})

const snapshotSchema = z.object({
  roundNumber: z.number(),
  totalRounds: z.number(),
  participantOrder: z.array(z.string()),
  // 옛 스냅샷에는 없는 필드가 null로 저장돼 있다 — 읽을 수 있게 관용한다.
  submissions: z.record(z.string(), submissionSchema).nullish(),
  activePlayerIndex: z.number(),
  activeRollCount: z.number(),
  activeDice: z.array(z.number()).nullish(),
  activeHeld: z.array(z.boolean()).nullish(),
  finished: z.boolean(),
})

/** 필드 순서는 저장 호환 계약이다(위 주석 참고). */
const toStateSnapshot = (state: RoundState): YachtDiceStateSnapshot => {
  const submissions: Record<string, YachtSubmissionSnapshot> = {}
  for (const [playerId, submission] of state.submissions) {
    submissions[playerId] = {
      playerId: submission.playerId,
      roundNumber: submission.roundNumber,
      dice: [...submission.dice],
      category: submission.category,
    }
  }
  return {
    roundNumber: state.roundNumber,
    totalRounds: state.totalRounds,
    participantOrder: [...state.participantOrder],
    submissions,
    activePlayerIndex: state.activePlayerIndex,
    activeRollCount: state.activeRollCount,
    activeDice: state.activeDice === null ? null : [...state.activeDice],
    activeHeld: state.activeHeld === null ? null : [...state.activeHeld],
    finished: state.finished,
  }
}

export const serializeState = (state: RoundState): string => JSON.stringify(toStateSnapshot(state))

/**
 * 저장된 JSON → 도메인 상태. `RoundState.restore`는 참가자 중복·인덱스 범위를
 * 검사하지 않는다 — 검증 없이 되살리는 것이 계약이다.
 *
 * @throws 파싱·검증 실패. 호출자(스토어)가 `invalid_yacht_state`로 감싼다.
 */
export const deserializeState = (value: string): RoundState => {
  const parsed = snapshotSchema.parse(JSON.parse(value))
  const submissions = new Map<string, RoundSubmission>()
  for (const [playerId, submission] of Object.entries(parsed.submissions ?? {})) {
    submissions.set(
      playerId,
      new RoundSubmission(
        submission.playerId,
        submission.roundNumber,
        submission.dice,
        submission.category,
      ),
    )
  }
  return RoundState.restore({
    roundNumber: parsed.roundNumber,
    totalRounds: parsed.totalRounds,
    participantOrder: parsed.participantOrder,
    submissions,
    activePlayerIndex: parsed.activePlayerIndex,
    activeRollCount: parsed.activeRollCount,
    activeDice: parsed.activeDice ?? null,
    activeHeld: parsed.activeHeld ?? null,
    finished: parsed.finished,
  })
}
