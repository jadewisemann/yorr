import type { HTMLAttributes } from 'react'
import { cn } from '@/shared/cn'

/*
 * 상자 표면. 캔버스 위에 한 덩어리를 올려 "여기까지가 한 묶음"을 말한다.
 *
 * 왜 `rounded-panel`인가: 실측하니 라운드가 panel 13 : card 14로 반반이었는데,
 * 갈리는 기준이 크기가 아니라 **모양**이었다 — card 14곳 중 10곳은 사방 패딩 없이
 * px/py만 쓰는 행·띠였고, panel 13곳은 전부 p-*를 두른 상자였다. Panel은 후자만
 * 가져간다. 행은 recipes.css의 `score-row` 쪽 몫이다.
 *
 * 패딩을 기본값으로 두지 않는 이유: p-1부터 p-6까지 열다섯 값으로 흩어져 있어
 * 어느 하나를 기본으로 잡으면 나머지가 전부 덮어쓴다. Badge와 같은 판단이다 —
 * 반복되는 것만 가져오고, 자리마다 다른 것은 호출부에 남긴다.
 */

const surfaces = {
  /* 캔버스 위 기본 면. */
  surface: 'bg-surface',
  /* 한 단 뜬 면 — 팝오버·시트·모달처럼 위에 겹쳐 서는 것. */
  raised: 'bg-surface-raised',
  /* 한 단 가라앉은 면 — 코드·로그처럼 안으로 파인 자리. */
  sunken: 'bg-surface-sunken',
} as const

/*
 * 태그를 고를 수 있어야 한다. 실측 13곳 중 <div>는 둘뿐이고 나머지는 <section>·
 * <article>·<ul>이다 — 상자를 <div>로 고정하면 시맨틱을 뺏는다.
 *
 * 속성 타입이 `HTMLAttributes<HTMLElement>`인 이유: `ComponentProps<'div'>`를 쓰면
 * `ref`가 `HTMLDivElement`로 굳어 `as="ul"`과 충돌한다. 여기 필요한 것은 태그마다
 * 다른 ref가 아니라 className·aria·이벤트 같은 공통 속성뿐이다.
 */
type PanelElement = 'div' | 'section' | 'article' | 'ul'

type PanelProps = HTMLAttributes<HTMLElement> & {
  as?: PanelElement
  surface?: keyof typeof surfaces
}

export function Panel({ as: Tag = 'div', className, surface = 'surface', ...props }: PanelProps) {
  return (
    <Tag
      className={cn('rounded-panel border border-border', surfaces[surface], className)}
      {...props}
    />
  )
}
