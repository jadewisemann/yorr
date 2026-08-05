import type { ComponentProps } from 'react'
import { cn } from '@/shared/cn'

/**
 * 화면 프레임. 높이 정책과 safe-area 여백만 소유하고 나머지 배치(max-w·배경·flex/grid)는
 * className으로 호출부가 정한다.
 *
 * `viewport`가 기본이 아닌 이유: 이 앱의 화면은 대부분 정확히 한 뷰포트를 프레임으로 잡고
 * 그 안에서 스크롤한다(GamePlay의 3D 트레이가 그 프레임에 맞춰 크기를 정한다). 문서 높이를
 * 늘리는 `min-h-svh`는 쓰지 않는다 — 근거는 `docs/log/S15P11A406-28.md`의 결정 기록.
 */
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
  /** 2열로 갈릴 폭인지. `useWideLayout()`의 값을 그대로 넘긴다. */
  wide: boolean
}

/**
 * 게임판 프레임 — 야추 진행·파티 대시보드·파티 결과가 같은 껍데기를 쓴다.
 * 넓은 폭에서 오른쪽 참가자 열이 붙는 것까지 이 껍데기가 소유한다.
 */
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

/**
 * 폰 컨트롤러 프레임 — 듀얼·탁구가 배경색만 다르고 나머지가 같다.
 * 배경은 도메인 캔버스 토큰을 className으로 넘긴다.
 */
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
