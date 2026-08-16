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

/*
 * 게임 캔버스 프레임 — 3D 코트·결투장·랜딩 히어로처럼 한 뷰포트를 꽉 채우고 그 안에서
 * 절대배치로 겹쳐 쌓는 화면.
 *
 * 왜 따로 있나: `relative h-svh w-full overflow-hidden`을 탁구·결투·랜딩 열두 곳이
 * 각자 적고 있었다. design-system.md가 "화면에서 h-svh 껍데기를 새로 쓰지 않는다"고
 * 못박은 그 규칙을 지킬 대상이 없었던 것이다.
 *
 * 배경색은 여기 두지 않는다. 게임마다 세계관이 달라 팔레트를 나눠 둔 것이고
 * (`pp-*`·`duel-*`·`landing-*`), shared가 도메인 색을 알면 의존 방향이 뒤집힌다.
 * 배경과 내부 배치는 호출부가 className으로 얹는다.
 */
export function GameCanvas({ className, ...props }: Omit<ComponentProps<typeof Screen>, 'frame'>) {
  return <Screen className={cn('relative w-full', className)} frame="viewport" {...props} />
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
