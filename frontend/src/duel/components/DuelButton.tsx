import type { ComponentProps } from 'react'
import { cn } from '@/shared/cn'
import { Button } from '@/shared/components/Button'

/*
 * 결투 도메인의 액션 버튼 — PingPongButton과 같은 처방(그쪽 주석 참고).
 * tone이 `duel-*` 팔레트라 도메인 안에 둔다.
 */

const variants = {
  /** 컨트롤러 본 액션 — 카드형 */
  action: 'min-h-12 rounded-card px-5 py-3 text-base',
  /** 게임 화면 위 알약 */
  chip: 'min-h-tap rounded-full px-4 py-1.5 text-sm',
} as const

const tones = {
  signal: 'border-duel-signal/50 bg-duel-signal/15 text-duel-accent-soft hover:bg-duel-signal/22',
  neutral: 'border-border bg-surface text-content hover:bg-surface-raised',
  // 민 brand 글자는 테마 표면에서 금지지만(#28) 결투 캔버스는 테마를 타지 않는
  // 고정 다크 무대라 예외다 — tokens.css 라이트 블록 주석 참고.
  brand: 'border-brand/50 bg-brand/12 text-brand hover:bg-brand/18',
} as const

type DuelButtonProps = Omit<ComponentProps<typeof Button>, 'variant' | 'size'> & {
  variant?: keyof typeof variants
  tone?: keyof typeof tones
}

export function DuelButton({
  className,
  tone = 'signal',
  variant = 'action',
  ...props
}: DuelButtonProps) {
  return (
    <Button
      className={cn(variants[variant], tones[tone], className)}
      size="sm"
      variant="ghost"
      {...props}
    />
  )
}
