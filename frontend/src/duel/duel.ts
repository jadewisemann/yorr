import { DUEL_FOUL } from '@/realtime/wsEvents'

/**
 * 결투 화면이 쓰는 상수와 표시 헬퍼. 규칙 자체는 서버(DuelRules)가 소유하고, 여기에는
 * 화면이 그리려면 알아야 하는 값만 둔다 — 서버 상태는 각자의 체력·경고만 보내주므로
 * "칸이 몇 개인지"는 이쪽이 알고 있어야 한다.
 */

/**
 * 총알이 어디로 갔는가. 부정출발은 상대가 아니라 자기 발밑으로 쏜다.
 * 무대(Arena)와 번역기(stage)가 함께 쓰는 말이라 둘 중 어느 쪽도 아닌 여기 둔다.
 */
export type ShotTarget = 'opponent' | 'ground'

/** 서버 DuelRules.MAX_HP와 같은 값. 총알(체력) 칸 수다. */
export const MAX_HP = 3
/** 서버 DuelRules.MAX_FOULS와 같은 값. 이 개수가 차면 자기 발을 쏘고 결투를 잃는다. */
export const MAX_FOULS = 2

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
