import type { ComponentProps } from 'react'
import { cn } from '@/shared/cn'
import { Button } from './Button'

/**
 * 게임 화면 크롬의 알약 버튼 — 나가기·방 닫기가 듀얼·탁구 네 파일 일곱 곳에서 같은 모양이었다.
 * 그중 넷은 위치(`top`·`left`)만 달랐고 나머지 class는 완전히 같았다.
 */
const tones = {
  /** 단색 캔버스 위. 컨트롤러 헤더의 조용한 보조 행동. */
  canvas: 'border-white/15 bg-surface-veil text-white/70',
  /** 살아 있는 3D 렌더 위. 뒤가 계속 움직이므로 스크림과 블러로 글자를 띄운다. */
  overlay: 'border-white/20 bg-black/45 backdrop-blur-md',
} as const

type GameChromeButtonProps = Omit<ComponentProps<typeof Button>, 'variant' | 'size'> & {
  tone?: keyof typeof tones
}

/**
 * `font-normal`을 남겨 둔 이유: 공통 `Button`은 굵은 글자가 기본이지만 이 일곱 자리는 전부
 * 굵기를 지정하지 않아 본문 굵기를 물려받고 있었다. 굵게 바꾸는 것은 게임 화면의 시각 결정이라
 * 이 리팩터에서 함께 하지 않는다 — 지우면 Button 기본값(bold)으로 올라간다.
 */
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
