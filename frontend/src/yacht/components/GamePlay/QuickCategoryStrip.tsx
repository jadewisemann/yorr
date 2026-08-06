import { cn } from '@/shared/cn'
import type { CategoryScores, YachtCategory } from '@/yacht/domain/scoring'
import { categoryLabel, categoryShortLabel } from '@/yacht/domain/yachtCategoryView'

/** 안내가 다음 단계로 넘어갈 근거. GamePlay가 이미 들고 있는 값을 그대로 준다. */
export interface TurnProgress {
  /** 이번 턴에 주사위가 깔렸는지(첫 굴림 완료). */
  rolled: boolean
  /**
   * 지금 킵되어 있는 주사위의 눈. 개수가 아니라 값까지 주는 이유는 연습 모드가
   * "6 두 개를 킵하세요"처럼 무엇을 킵했는지까지 보고 다음으로 넘어가야 하기 때문이다.
   */
  keptValues: number[]
  /**
   * 주사위가 날아가는 중인지. rollCount는 굴림이 **시작될 때** 서버 값으로 올라가고 dice는
   * 애니메이션이 끝나야 바뀐다 — 그 사이에 안내가 "새 굴림 수 + 옛 주사위"를 읽으면
   * 아직 일어나지 않은 선택이 끝난 것처럼 보인다.
   */
  rolling: boolean
  /** 이번 턴 기록까지 끝났는지. */
  submitted: boolean
  /** 서버가 확정한 굴림 횟수. */
  rollCount: number
  /** 지금 주사위로 각 족보가 몇 점인지 — 족보 설명을 실제 눈과 함께 보여줄 때 쓴다. */
  candidates: CategoryScores
  /**
   * 모션 센서를 켤 수 있는 기기인지. 센서가 없는 기기(데스크톱 등)에서는 켤 것이 없으므로
   * 연습 모드가 흔들기 단계를 통째로 건너뛰는 근거가 된다.
   */
  motionNoticeVisible: boolean
  /**
   * 넓은 레이아웃인지. 점수표가 우측 상시 패널이냐 아래 기록 패널이냐가 갈리므로
   * 안내 문구도 갈라야 한다 — "오른쪽 점수표"와 "아래 기록 패널"은 다른 화면이다.
   */
  wide: boolean
}

export function QuickCategoryStrip({
  canPick,
  candidates,
  categories,
  leverageCategory,
  onPick,
  rolled,
}: {
  canPick: boolean
  candidates: CategoryScores
  categories: YachtCategory[]
  leverageCategory: YachtCategory | null
  onPick: (category: YachtCategory) => void
  rolled: boolean
}) {
  return (
    // 연습 모드가 "여기서 기록한다"고 가리키는 자리 — 모바일에서 족보를 탭하는 실제 지점이다.
    <ul
      className="m-0 flex list-none gap-2 overflow-x-auto px-4 py-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      data-tutorial="sheet"
    >
      {categories.map((category) => {
        const score = rolled ? (candidates[category] ?? 0) : null
        const scoreLabel = score === null ? '' : ` ${score}점 기록`
        // 레버리지 칩은 색만으로 구분하지 않는다 — ×2 배지가 흑백에서도 읽힌다.
        const leveraged = category === leverageCategory
        return (
          <li className="flex-none" key={category}>
            <button
              aria-label={`${categoryLabel[category]}${leveraged ? ' 2배' : ''}${scoreLabel}`}
              className={cn('quick-chip focus-ring', leveraged && 'border-2 border-brand')}
              data-tutorial-category={category}
              disabled={!canPick || !rolled}
              onClick={() => onPick(category)}
              type="button"
            >
              <span className="flex items-center gap-1 text-2xs font-semibold tracking-[0.07em] uppercase">
                {categoryShortLabel[category]}
                {leveraged && <span className="text-brand-strong">×2</span>}
              </span>
              <span className="font-mono text-xl leading-none font-bold tabular-nums">
                {score ?? '—'}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
