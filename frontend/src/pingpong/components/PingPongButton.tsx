import type { ComponentProps } from 'react'
import { cn } from '@/shared/cn'
import { Button } from '@/shared/components/Button'

/*
 * 탁구 도메인의 액션 버튼. GameChromeButton과 같은 처방 — `Button`을 감싸고
 * variant/tone map만 얹는다(design-system.md 규칙 1). shared에 두지 않는 이유:
 * tone이 `pp-*` 팔레트라 shared가 도메인 색을 알면 의존 방향이 뒤집힌다
 * (`GameCanvas`가 배경색을 안 드는 것과 같은 이유).
 *
 * 회수 전 손으로 적혀 있던 것: `active:scale-[0.98]` 직접 표기(규칙 5 위반),
 * 대체 조작 버튼의 focus-ring 누락. 둘 다 Button 기반이 되며 해결된다.
 */

const variants = {
  /** 컨트롤러 본 액션 — 카드형 */
  action: 'min-h-12 rounded-card px-5 py-3 text-base',
  /** 헤더 크롬 속 알약 */
  chip: 'min-h-tap rounded-full px-3 py-1.5 text-xs',
  /** 화면의 주 CTA(READY) — 한 화면에 하나 */
  cta: 'min-h-14 rounded-card px-5 py-3 text-lg font-black',
} as const

const tones = {
  accent: 'border-pp-accent/45 bg-pp-accent/12 text-pp-accent-text hover:bg-pp-accent/18',
  neutral: 'border-border-strong bg-surface-veil text-content hover:bg-surface-veil-raised',
  danger:
    'border-transparent bg-pp-danger text-on-brand hover:bg-pp-danger disabled:bg-surface-veil disabled:text-content/35',
} as const

type PingPongButtonProps = Omit<ComponentProps<typeof Button>, 'variant' | 'size'> & {
  variant?: keyof typeof variants
  tone?: keyof typeof tones
}

export function PingPongButton({
  className,
  tone = 'accent',
  variant = 'action',
  ...props
}: PingPongButtonProps) {
  return (
    <Button
      className={cn(variants[variant], tones[tone], className)}
      size="sm"
      variant="ghost"
      {...props}
    />
  )
}
