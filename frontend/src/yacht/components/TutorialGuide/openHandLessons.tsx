import { cn } from '@/shared/cn'
import type { CategoryScores, YachtCategory } from '@/yacht/domain/scoring'
import { UPPER_BONUS_POINTS, UPPER_BONUS_THRESHOLD } from '@/yacht/domain/scoring'

/**
 * 각 단계에서 강조할 화면 조각. GamePlay가 붙여 둔 data-tutorial 표지를 찾는다 —
 * 좌표를 여기 적어 두면 레이아웃이 바뀔 때마다 조용히 어긋난다.
 *
 * 족보를 설명하는 동안에는 설명 중인 **그 칸**을 짚는다. 규칙만 읽어 주면 점수표에서 어느
 * 칸인지는 여전히 모르므로, 이름과 자리를 같은 순간에 붙여 준다.
 */
/**
 * 족보 12칸을 **한 칸씩** 설명한다(S15P11A406-143). 예전에는 "설명은 ? 도움말에 있어요"로
 * 넘겼는데, 처음 온 사람에게 다른 곳을 찾아가라고 하면 대개 안 찾아간다 — 규칙을 알아야
 * 어디에 적을지 고를 수 있으니 마스코트가 직접 말한다.
 *
 * 위 여섯 칸도 묶지 않고 하나씩 짚는다. "고른 숫자만 더해요" 한 줄로 묶으면 규칙은 맞지만
 * 점수표에서 어느 칸이 무엇인지는 여전히 모른다 — 설명하는 칸을 화면에서 같이 강조하므로
 * 칸과 이름이 여기서 처음 연결된다.
 *
 * 이름은 categoryLabel에서 가져온다. 여기 따로 적으면 점수표와 다르게 부르는 순간이 온다.
 */
const HAND_LESSONS: ReadonlyArray<{
  /** 점수표에서 짚을 칸. 보너스처럼 칸이 아닌 장은 없다 — 그 장은 가운데에서 읽는다. */
  category?: YachtCategory
  /** 칸이 아닌 장의 제목. */
  name?: string
  rule: string
}> = [
  { category: 'ones', rule: '1이 나온 개수만큼 1점씩 더해요. 세 개면 3점이에요.' },
  { category: 'twos', rule: '2가 나온 개수만큼 2점씩 더해요.' },
  { category: 'threes', rule: '3이 나온 개수만큼 3점씩 더해요.' },
  { category: 'fours', rule: '4가 나온 개수만큼 4점씩 더해요.' },
  { category: 'fives', rule: '5가 나온 개수만큼 5점씩 더해요.' },
  {
    category: 'sixes',
    rule: '6이 나온 개수만큼 6점씩 더해요. 위 여섯 칸 중 한 개당 점수가 가장 커요.',
  },
  // 위 여섯 칸을 다 본 직후, 그 칸들이 모여 만드는 보너스를 말한다 — 아래 족보로 넘어가기 전에.
  // 점수·기준은 점수표가 "소계 / 63 · 보너스 +35"로 쓰는 것과 같은 상수를 읽는다.
  {
    name: '위 칸 보너스',
    rule: `방금 본 여섯 칸의 합이 ${UPPER_BONUS_THRESHOLD}점을 넘으면 보너스 ${UPPER_BONUS_POINTS}점이 따로 붙어요. 숫자마다 세 개씩만 모으면 딱 ${UPPER_BONUS_THRESHOLD}점이에요.`,
  },
  { category: 'choice', rule: '모양을 안 따져요. 눈 다섯 개를 그냥 다 더해서 적어요.' },
  { category: 'fourOfAKind', rule: '같은 눈이 4개 모이면 다섯 개를 다 더해요.' },
  { category: 'fullHouse', rule: '같은 눈 3개와 다른 눈 2개가 함께 있으면 다 더해요.' },
  { category: 'smallStraight', rule: '이어지는 눈 4개(예: 2·3·4·5)면 무조건 15점이에요.' },
  { category: 'largeStraight', rule: '이어지는 눈 5개(예: 2·3·4·5·6)면 30점이에요.' },
  { category: 'yacht', rule: '다섯 개가 모두 같은 눈이면 50점 — 이 게임에서 가장 큰 점수예요.' },
]

/**
 * 아직 비어 있는 칸만 골라 설명한다. 방금 기록한 칸은 이미 무엇인지 배웠고, 점수표에서도
 * 사용됨으로 잠겨 강조할 자리가 없다.
 *
 * `candidates`에는 미기입 칸만 들어온다(calculateScoreCandidates가 사용한 칸을 뺀다).
 */
export function openHandLessons(candidates: CategoryScores) {
  // 칸이 없는 장(보너스)은 기록과 무관하므로 항상 남는다.
  return HAND_LESSONS.filter(
    (hand) => hand.category === undefined || candidates[hand.category] !== undefined,
  )
}

/**
 * 지금 주사위가 이 족보에 몇 점인지. 규칙만 적으면 외울 것이 늘 뿐이라 실제 점수를 붙인다 —
 * 0점은 "지금 주사위는 이 모양이 아니다"를 스스로 말해 준다.
 */
export function HandScore({ score }: { score: number }) {
  return (
    <p
      className={cn(
        'm-0 text-xs font-semibold',
        score > 0 ? 'text-brand-strong' : 'text-content-faint',
      )}
    >
      {score > 0
        ? `지금 주사위로 적으면 ${score}점이에요.`
        : '지금 주사위는 이 모양이 아니라 0점이에요.'}
    </p>
  )
}
