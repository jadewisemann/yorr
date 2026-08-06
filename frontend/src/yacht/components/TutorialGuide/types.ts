import type { CategoryScores, YachtCategory } from '@/yacht/domain/scoring'

/**
 * 굴림 → 선택을 두 번 되풀이하고, 마지막 굴림을 흔들기로 체험한 뒤 족보를 설명한다.
 *
 * 요트의 한 턴은 "굴리고 남길 것을 고른다"의 반복이다. 그 반복을 한 번만 보여주면 규칙이
 * 아니라 일회성 조작으로 읽혀서, 2굴림 뒤에도 고르는 단계(keepAgain)를 둔다 — 킵이 쌓이는
 * 것이 여기서 처음 눈에 보인다.
 *
 * 족보는 손이 하는 일(굴림·선택)을 다 끝낸 뒤로 미룬다. 던지다 말고 읽고 다시 던지면
 * 흐름이 끊긴다.
 */
export type GuideStep =
  | 'greet'
  | 'roll'
  | 'keep'
  | 'reroll'
  | 'keepAgain'
  | 'askLastRoll'
  | 'motion'
  | 'lastRoll'
  | 'record'
  | 'categories'
  | 'done'

export interface Lesson {
  title: string
  body: string
  /** 눌러야 다음으로 가는 단계에는 버튼을 두지 않는다 — 직접 해보는 것이 요점이다. */
  action?: string
  /** 두 갈래로 갈리는 단계의 다른 쪽 선택. 지금은 마지막 굴림을 어떻게 던질지 뿐이다. */
  secondary?: { label: string; step: GuideStep }
  /**
   * 족보 한 장을 설명하는 중. 설명하는 칸을 점수표에서 같이 강조하므로 어느 칸인지까지
   * 들고 있어야 한다 — 보너스처럼 짚을 칸이 없는 장은 category가 없다.
   */
  hand?: { category?: YachtCategory; index: number; total: number; score?: number | undefined }
}

export interface LessonContext {
  /** 지금 트레이에 6이 몇 개인지. 대본대로면 킵 단계에서 2개, 마지막에 4개다. */
  sixes: number
  /** 식스에 기록하면 몇 점인지. */
  sixesScore: number
  /** 그중 이미 킵한 6의 개수. 몇 개 남았는지 세어 준다. */
  keptSixes: number
  /** 6이 아닌데 킵해 둔 주사위 수. 있으면 풀라고 알려 준다. */
  keptOther: number
  /** 족보 설명 중 몇 번째 장을 보고 있는지. */
  handIndex: number
  /** 센서를 켤 수 있는 기기인지. 마지막 굴림을 어떻게 던질지 묻는 문구가 갈린다. */
  motionNoticeVisible: boolean
  /** 지금 주사위의 족보별 점수. 설명 옆에 실제 점수를 붙인다. */
  candidates: CategoryScores
  wide: boolean
}

export interface SpotlightRect {
  top: number
  left: number
  width: number
  height: number
}
