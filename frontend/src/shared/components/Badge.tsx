import type { ComponentProps } from 'react'
import { cn } from '@/shared/cn'

/*
 * 알약 배지. 옆의 것을 한 낱말로 한정한다 — "대기 중", "추천", "2인".
 *
 * 크기는 자리마다 다르다(실측: 패딩 5종 · 글자 2종). 사다리를 여기서 강제하면
 * 일곱 자리의 겉모습이 한꺼번에 바뀌므로, **크기는 호출부에 남기고 톤만 가져온다.**
 * 반복되던 것은 크기가 아니라 색 세 줄이었다 — warning 두 곳은 바이트까지 같았다.
 *
 * 블록 알림은 Alert의 몫이다. 이건 문장이 아니라 낱말을 담는 자리다.
 */

const tones = {
  neutral: 'border-border text-content-muted',
  warning: 'border-warning/40 bg-warning/12 text-warning',
  // 글자는 brand가 아니라 brand-strong — 민 brand는 라이트 canvas 위 3.54:1로 본문
  // 기준(4.5)에 미달한다(brand-strong은 다크 6.08 / 라이트 4.71). brand 톤 글자를
  // brand-strong으로 쓰는 선례는 LeveragePage가 먼저다.
  brand: 'border-brand/40 text-brand-strong',
} as const

type BadgeProps = ComponentProps<'span'> & {
  tone?: keyof typeof tones
}

export function Badge({ className, tone = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-bold',
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}
