import { cn } from '@/shared/cn'
import type { CategoryScores, YachtCategory } from '@/yacht/domain/scoring'
import { UPPER_BONUS_POINTS, UPPER_BONUS_THRESHOLD } from '@/yacht/domain/scoring'

const HAND_LESSONS: ReadonlyArray<{
  category?: YachtCategory
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

export function openHandLessons(candidates: CategoryScores) {
  return HAND_LESSONS.filter(
    (hand) => hand.category === undefined || candidates[hand.category] !== undefined,
  )
}

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
