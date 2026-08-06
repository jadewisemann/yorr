import type { Game } from '@/games'
import { cn } from '@/shared/cn'

interface LandingMetaPillsProps {
  game: Game
  layout: 'narrow' | 'wide'
}

/** 필 치수. narrow가 한 단 작은 이유는 순전히 폭이다 — 390에서 카드 안쪽이 297px이고
    세 칸 합이 273px이라 여기서 한 단만 키워도 두 줄로 접힌다. 접히면 하단 덩어리가
    36px 두꺼워진다. */
const metaPillSize = {
  narrow: 'h-7.5 px-1.5 text-2xs',
  wide: 'h-8.5 px-3 text-xs',
} as const

const metaBadgeSize = {
  narrow: 'text-2xs',
  wide: 'text-xs',
} as const

/**
 * 인원 · 소요 시간 · 조작 세 칸. 첫 칸만 mono 대문자 배지다.
 * <p>
 * 예전 네 번째 칸("실시간 멀티플레이")은 걷었다. 다섯 카드에 똑같이
 * 붙는 값이라 변별 정보가 0인데 가장 넓고(narrow 132px, 행 전체의 44%), 페이지 h1이 이미
 * "…파티 게임"이라고 말한다. 이 칸을 빼야 narrow 필이 한 줄에 든다.
 */
export function LandingMetaPills({ game, layout }: LandingMetaPillsProps) {
  const pillBase = cn(
    'inline-flex flex-none items-center rounded-full border whitespace-nowrap',
    metaPillSize[layout],
  )

  return (
    <>
      <span
        className={cn(
          pillBase,
          'font-mono font-bold tracking-[0.12em]',
          metaBadgeSize[layout],
          game.live
            ? 'border-landing-accent/45 bg-landing-accent-tint text-landing-accent-text'
            : 'border-landing-hairline-strong bg-landing-well text-landing-text-strong',
        )}
      >
        {game.players}
      </span>
      {[game.duration, game.control].map((label) => (
        <span
          className={cn(
            pillBase,
            'border-landing-hairline-strong bg-landing-well font-semibold text-landing-text-strong',
          )}
          key={label}
        >
          {label}
        </span>
      ))}
    </>
  )
}
