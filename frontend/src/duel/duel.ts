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
/** 서버 DuelRules.MAX_FOULS와 같은 값. 이 개수가 차면 자기 발을 쏜다. */
export const MAX_FOULS = 2

/**
 * 총알이 지나는 구간의 좌우 여백(무대 폭 대비). Arena가 총알 트랙을 이 값으로 세우고,
 * 아래 flightMs가 같은 값으로 사거리를 낸다 — 둘이 갈라지면 착탄 시각이 어긋난다.
 */
export const BULLET_TRACK_INSET = 0.24

/**
 * 총알 속도(px/ms)와 시간 상하한.
 *
 * 폭이 390px인 폰과 1280px인 노트북에서 사거리가 3배 차이 난다. 시간을 고정하면 폰에서는
 * 총알이 기어가고 노트북에서는 순간이동한다. 그래서 <b>거리를 재서 시간을 낸다</b>. 다만
 * 순수 등속으로 두면 노트북에서 800ms를 넘어 늘어지므로 상하한으로 가둔다.
 */
const BULLET_SPEED_PX_MS = 1.6
/**
 * 좁은 화면의 하한. 등속으로 두면 폰에서 130ms인데, 그러면 판정이 도착하기도 전에 총알이
 * 닿아 버려 피격이 늘 총알보다 늦는다(실측 63ms 지각). 왕복 지연을 덮을 만큼은 날아야
 * 착탄과 피격이 같은 프레임에 온다.
 */
const MIN_FLIGHT_MS = 260
const MAX_FLIGHT_MS = 420

/**
 * 이 화면에서 총알이 나는 시간. 무대 폭 하나만 받아 두 총잡이 사이 거리를 내고, 속도로
 * 나눈다. 착탄·피격 자세·체력·섬광·화면 흔들림·문구가 모두 이 값 하나를 기준으로 잡히므로
 * 화면 크기가 바뀌어도 서로 어긋나지 않는다.
 */
export function flightMs(stageWidth: number): number {
  const distance = Math.max(0, stageWidth) * (1 - BULLET_TRACK_INSET * 2)
  const raw = distance / BULLET_SPEED_PX_MS
  return Math.round(Math.min(MAX_FLIGHT_MS, Math.max(MIN_FLIGHT_MS, raw)))
}

/**
 * 빗나간 쪽에게 던지는 한마디.
 *
 * 진 쪽도 총을 쐈고 총알은 상대까지 날아간다 — 다만 빗나간다. 아무 말 없이 사라지면
 * "맞혔는데 아무 일도 없다"로 읽히므로, 빗나갔다는 사실을 말로 못 박는다.
 */
const MISS_TAUNTS = [
  '눈 감고 쐈나',
  '손이 떨렸군',
  '모자만 스쳤다',
  '바람이 도왔군',
  '탄이 아깝다',
  '조금 더 자고 왔어야',
] as const

/**
 * 이 라운드의 비아냥. 난수를 쓰지 않는다 — 두 사람이 <b>같은 말</b>을 봐야 하고, 같은
 * 라운드를 다시 그려도(재접속·리렌더) 말이 바뀌면 안 된다. 그래서 서버가 준 값에서 뽑는다.
 */
export function missTaunt(seed: number): string {
  return MISS_TAUNTS[Math.abs(Math.trunc(seed)) % MISS_TAUNTS.length] ?? MISS_TAUNTS[0]
}

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
