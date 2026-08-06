import { cn } from '@/shared/cn'
import type { SpotlightRect } from '@/yacht/components/TutorialGuide/types'

/**
 * 각 단계에서 강조할 화면 조각. GamePlay가 붙여 둔 data-tutorial 표지를 찾는다 —
 * 좌표를 여기 적어 두면 레이아웃이 바뀔 때마다 조용히 어긋난다.
 *
 * 족보를 설명하는 동안에는 설명 중인 **그 칸**을 짚는다. 규칙만 읽어 주면 점수표에서 어느
 * 칸인지는 여전히 모르므로, 이름과 자리를 같은 순간에 붙여 준다.
 */
/**
 * 강조한 곳만 빼고 화면을 덮는다. 눌러야 할 것 하나만 밝게 남으니 "여기"가 설명 없이 읽히고,
 * 덮인 자리는 클릭도 막혀 배우는 중에 엉뚱한 곳을 눌러 길을 잃지 않는다.
 *
 * 구멍 난 한 장이 아니라 네 장으로 둘러싸는 이유: box-shadow로 판 구멍은 그림자라 클릭을
 * 막지 못하고, clip-path로 판 구멍은 가장자리가 계단처럼 깨진다. 네 장이면 구멍의 네 변이
 * 정확히 맞고 각 장이 그대로 차단막이 된다.
 *
 * 누를 곳이 없는 단계(인사 · 마무리)는 통째로 덮어 읽는 데 집중시킨다.
 */
export function Backdrop({ dim, spotlight }: { dim: boolean; spotlight: SpotlightRect | null }) {
  if (!spotlight) {
    return <div className="pointer-events-auto absolute inset-0 bg-black/72" />
  }

  const top = spotlight.top - 6
  const left = spotlight.left - 6
  const right = spotlight.left + spotlight.width + 6
  const bottom = spotlight.top + spotlight.height + 6
  // 구멍 주변만 덮는다 — 밝게 남은 한 곳이 곧 "여기를 누르세요"다.
  // dim이 꺼진 단계에서는 색만 빼고 차단막은 남긴다(dimsAroundHole 주석 참고).
  const block = cn('pointer-events-auto absolute', dim && 'bg-black/72')

  return (
    <>
      <div className={block} style={{ top: 0, left: 0, right: 0, height: Math.max(0, top) }} />
      <div className={block} style={{ top: bottom, left: 0, right: 0, bottom: 0 }} />
      <div
        className={block}
        style={{ top, height: bottom - top, left: 0, width: Math.max(0, left) }}
      />
      <div className={block} style={{ top, height: bottom - top, left: right, right: 0 }} />
      <div
        className="pointer-events-none absolute rounded-panel ring-3 ring-brand-strong motion-safe:animate-tutorial-halo"
        style={{ top, left, width: spotlight.width + 12, height: spotlight.height + 12 }}
      />
    </>
  )
}
