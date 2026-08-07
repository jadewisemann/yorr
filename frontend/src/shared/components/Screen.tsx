import type { ComponentProps } from 'react'
import { cn } from '@/shared/cn'

const frames = {
  flow: 'flex min-h-dvh flex-col px-gutter pt-safe-top pb-safe-bottom',
  viewport: 'h-svh overflow-hidden',
} as const

type ScreenProps = ComponentProps<'main'> & {
  frame?: keyof typeof frames
}

export function Screen({ className, frame = 'flow', ...props }: ScreenProps) {
  return <main className={cn('mx-auto w-full text-content', frames[frame], className)} {...props} />
}

type PlayBoardProps = Omit<ComponentProps<typeof Screen>, 'frame'> & {
  wide: boolean
}

export function PlayBoard({ className, wide, ...props }: PlayBoardProps) {
  return (
    <Screen
      className={cn(
        'max-w-play bg-canvas',
        wide ? 'grid grid-cols-[minmax(0,1fr)_28rem]' : 'flex flex-col',
        className,
      )}
      frame="viewport"
      {...props}
    />
  )
}

export function ControllerScreen({
  className,
  ...props
}: Omit<ComponentProps<typeof Screen>, 'frame'>) {
  return (
    <Screen
      className={cn(
        'relative flex touch-none flex-col px-5 pt-safe-top pb-safe-bottom text-white select-none',
        className,
      )}
      frame="viewport"
      {...props}
    />
  )
}
