import { calculateScore, SCORE_CATEGORIES, type ScoreCategory } from '../score/index.js'

/** 12키 전부가 숫자다. 조회 REST의 점수판(`number | null`)과 다른 모양이다. */
export type ScoreCandidates = Readonly<Record<ScoreCategory, number>>

/**
 * 주사위 하나로 12칸의 **가정 점수**를 뽑는다.
 *
 * 점수판과 달리 **불충족 족보는 `null`이 아니라 `0`** 이다 — "이 칸에 넣으면
 * 0점"이라는 뜻이고, 미기록을 뜻하는 점수판의 `null`과 의미가 다르다.
 * `calculateScore`가 이미 그 규칙(불충족 → 0)을 들고 있으므로 그대로 쓴다.
 *
 * 상태를 전혀 읽지 않는 순수 함수다 — 라우트가 `gameId`를 받지만 쓰지 않고
 * 인증도 하지 않는 이유(quirk이자 계약).
 */
export const calculateScoreCandidates = (dice: readonly number[]): ScoreCandidates => {
  const candidates: Partial<Record<ScoreCategory, number>> = {}
  for (const category of SCORE_CATEGORIES) {
    candidates[category] = calculateScore(category, dice)
  }
  return Object.freeze(candidates as Record<ScoreCategory, number>)
}
