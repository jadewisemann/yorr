import type { ComponentProps } from 'react'
import { cn } from '@/shared/cn'
import { Button } from './Button'

const tones = {
  canvas: 'border-border-raised bg-surface-veil text-white/70',
  overlay: 'border-border-strong bg-black/45 backdrop-blur-md',
} as const

type GameChromeButtonProps = Omit<ComponentProps<typeof Button>, 'variant' | 'size'> & {
  tone?: keyof typeof tones
}

export function GameChromeButton({ className, tone = 'canvas', ...props }: GameChromeButtonProps) {
  return (
    <Button
      className={cn('rounded-full px-4 font-normal', tones[tone], className)}
      size="sm"
      variant="ghost"
      {...props}
    />
  )
}
