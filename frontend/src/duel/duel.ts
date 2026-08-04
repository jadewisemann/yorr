import { DUEL_FOUL } from '@/realtime/wsEvents'

/**
 * 결투 화면이 쓰는 상수와 표시 헬퍼. 규칙 자체는 서버(DuelRules)가 소유하고, 여기에는
 * 화면이 그리려면 알아야 하는 값만 둔다 — 서버 상태는 각자의 체력·경고만 보내주므로
 * "칸이 몇 개인지"는 이쪽이 알고 있어야 한다.
 */

/** 서버 DuelRules.MAX_HP와 같은 값. 총알(체력) 칸 수다. */
export const MAX_HP = 3
/** 서버 DuelRules.MAX_FOULS와 같은 값. 이 개수가 차면 자기 발을 쏜다. */
export const MAX_FOULS = 2

/**
 * 총알이 상대에게 닿는 시간. tokens.css의 duel-bullet-r/l 길이와 같아야 한다 —
 * 피격 자세와 체력 감소를 총알이 도착하는 순간에 맞추는 타이머가 이 값을 쓴다.
 */
export const BULLET_MS = 340

/** 정상적으로 뽑았는가 — 부정출발·미반응 센티넬이 아닌 실제 기록. */
export function isClean(ms: number | null | undefined): ms is number {
  return typeof ms === 'number' && ms >= 0
}

/**
 * 개수가 정해진 계기판(탄약·경고)의 칸을 "채워졌는지"와 함께 늘어놓는다.
 * 칸은 순서가 바뀌지 않아 자리가 곧 정체성이므로 key도 자리에서 만든다.
 */
export function slots(name: string, total: number, filled: number) {
  return Array.from({ length: total }, (_, index) => ({
    filled: index < filled,
    id: `${name}-${index}`,
  }))
}

/** 반응 시간 표시 문구. 센티넬은 숫자가 아니라 상황으로 읽힌다. */
export function msLabel(ms: number | null | undefined): string {
  if (ms === DUEL_FOUL) return '성급했다'
  if (!isClean(ms)) return '얼어붙음'
  return `${ms}ms`
}
