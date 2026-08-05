import { DUEL_FOUL, type DuelState } from '@/realtime/wsEvents'

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

/**
 * 무엇으로 뽑았는가. 세 입력이 모두 같은 `draw()`로 수렴하지만 <b>동작에 걸리는 시간이
 * 다르다</b> — 폰을 휘두르려면 팔이 움직여야 하고, 탭과 스페이스바는 손가락만 움직인다.
 * 같은 반응속도로 재면 스윙 쪽이 구조적으로 진다.
 */
export type DuelInputSource = 'key' | 'swing' | 'tap'

/**
 * 입력별 페널티(ms). 스윙이 기준(0)이고 손가락 입력에 그만큼을 얹는다.
 *
 * <b>실기기에서 튜닝하는 값이다.</b> 팔을 휘두르는 데 걸리는 시간에서 임계값(threshold 15)을
 * 넘기는 순간까지가 진짜 차이인데, 그건 기기 센서 샘플링 주기와 사람 팔 길이에 달렸다 —
 * 계산으로 나오지 않는다. 지금 값은 두 입력을 나란히 눌러 본 초기 추정이다.
 *
 * 탭과 키보드를 같은 값으로 두는 이유는 둘 다 "손가락 한 번"이라서다. 폰 터치 패널 지연이
 * 키보드보다 20~40ms 크다는 보고가 있으니, 실기기에서 갈라야 하면 여기서 갈라진다.
 *
 * ponytail: 서버 `DuelRules.GRACE_MILLIS`(700)이 천장이다 — 페널티는 전송을 그만큼 늦춰서
 * 거는데(이유는 DuelGame.draw 주석), 유예보다 길게 잡으면 기다리는 동안 라운드가 끝나
 * "얼어붙음"으로 기록된다. 실기기 튜닝도 이 안에서 한다.
 */
export const DRAW_PENALTY_MS: Record<DuelInputSource, number> = {
  key: 100,
  swing: 0,
  tap: 100,
}

/**
 * 이 뽑기에 얹을 페널티(ms).
 *
 * 센티넬은 0이다 — 부정출발(-1)에 100을 더하면 99가 되어 <b>가장 빠른 정상 기록</b>으로
 * 둔갑한다. 얼어붙음(-2)도 마찬가지고, 애초에 둘 다 "얼마나 빨랐나"가 아니라 상황이다.
 */
export function drawPenaltyMs(reactionMs: number, source: DuelInputSource): number {
  return isClean(reactionMs) ? DRAW_PENALTY_MS[source] : 0
}

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
 * 총알이 스쳐 지나간 쪽이 내뱉는 한마디.
 *
 * 진 쪽도 총을 쐈고 총알은 상대까지 날아간다 — 다만 빗나간다. 아무 말 없이 사라지면
 * "맞혔는데 아무 일도 없다"로 읽히므로, <b>안 맞은 쪽 머리 위</b>에 말풍선으로 띄운다.
 * 화면 가운데 설명문이 아니라 승자의 입이라, 문장은 전부 상대에게 던지는 말투다.
 */
const MISS_TAUNTS = [
  '눈 감고 쐈나?',
  '손이 떨렸군',
  '모자만 스쳤다',
  '바람이 도와줬어',
  '탄약이 아깝군',
  '조금 더 자고 왔어야지',
  '거기서 쏘면 맞겠나',
  '그걸로 날 잡겠다고?',
  '느려',
  '어딜 보고 쏘는 거야',
  '늙은이',
  '애송이',
  '되겠냐',
  '풉',
  '쉽다',
  '귀엽네',
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

/**
 * 손 안의 컨트롤러가 읽는 한 줄. (S15P11A406-207)
 *
 * 큰 화면(Arena)은 라운드를 <b>이야기</b>로 풀지만(누가 빗나갔고 몇 ms였고 비아냥까지) 폰은
 * 아래를 보는 시간이 짧다 — 자기에게 무슨 일이 일어났는지만 한 단어로 안다. 그래서 같은
 * 라운드를 두 화면이 다르게 말하고, 이 함수는 <b>폰 쪽 어휘</b>만 맡는다.
 *
 * 톤은 세 가지다: 'win'은 내가 이겼을 때, 'lose'는 내가 맞았을 때, 'warn'은 경고·무승부처럼
 * 체력이 안 깎인 채 끝난 라운드다.
 */
export function drawOutcome(
  state: DuelState,
  you: string,
): { label: string; tone: 'lose' | 'warn' | 'win' } {
  const round = state.lastRound
  if (!round) return { label: '대기', tone: 'warn' }
  const mine = round.foulId === you
  switch (round.kind) {
    case 'FORFEIT':
      return { label: '상대가 떠났다', tone: 'win' }
    case 'SELF_SHOT':
      return mine
        ? { label: '자기 발을 쐈다', tone: 'lose' }
        : { label: '상대가 자기 발을 쐈다', tone: 'win' }
    case 'TIE':
      return { label: '동시에 뽑았다', tone: 'warn' }
    case 'WARNING':
      return mine ? { label: '성급했다', tone: 'warn' } : { label: '상대가 성급했다', tone: 'warn' }
    default:
      // 얼어붙어 못 뽑은 쪽도 맞는다 — 쏜 사람이 아닌 쪽은 전부 'lose'다.
      return round.shooterId === you
        ? { label: '명중!', tone: 'win' }
        : { label: '맞았다', tone: 'lose' }
  }
}

/** 반응 시간 표시 문구. 센티넬은 숫자가 아니라 상황으로 읽힌다. */
export function msLabel(ms: number | null | undefined): string {
  if (ms === DUEL_FOUL) return '성급했다'
  if (!isClean(ms)) return '얼어붙음'
  return `${ms}ms`
}
