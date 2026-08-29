import { tileLabel } from '@/davinci/domain/davinci'
import type { DavinciTile } from '@/realtime/wsEvents'
import { cn } from '@/shared/cn'

type TileSize = 'md' | 'sm'

const sizes = {
  md: 'h-16 w-11 text-2xl',
  sm: 'h-12 w-8 text-lg',
} as const

interface TileProps {
  tile: DavinciTile
  size?: TileSize
  selected?: boolean
  /** 누를 수 있으면 버튼으로, 아니면 그냥 판 위의 타일로 그린다. */
  onSelect?: (() => void) | undefined
}

/**
 * 타일 한 장. **색은 언제나 보이고 숫자만 감춰진다** — 이 게임의 규칙이 그대로
 * 컴포넌트의 모양이 된다(감춘 타일은 물음표, 공개된 타일은 눕혀서 흐리게).
 */
export function Tile({ onSelect, selected = false, size = 'md', tile }: TileProps) {
  const black = tile.color === 'BLACK'
  const className = cn(
    'grid place-items-center rounded-chip border font-black tabular-nums transition-[transform,box-shadow,opacity] duration-150',
    sizes[size],
    black
      ? 'border-white/12 bg-dv-black text-dv-black-ink'
      : 'border-black/15 bg-dv-white text-dv-white-ink',
    // 공개된 타일은 판정이 끝난 정보다 — 눕혀서 남은 감춘 타일과 한눈에 갈라 놓는다.
    tile.revealed && 'translate-y-1 opacity-60',
    selected && '-translate-y-1.5 shadow-[0_0_0_2px_var(--ds-dv-accent)]',
    onSelect && 'pressable focus-ring cursor-pointer',
  )

  if (!onSelect) {
    return (
      // 글자는 숫자나 물음표 하나뿐이라, 읽어 주는 값은 색까지 담은 라벨이어야 한다.
      <span aria-label={ariaLabel(tile)} className={className} role="img">
        {tileLabel(tile)}
      </span>
    )
  }
  return (
    <button
      aria-label={ariaLabel(tile)}
      aria-pressed={selected}
      className={className}
      onClick={onSelect}
      type="button"
    >
      {tileLabel(tile)}
    </button>
  )
}

const ariaLabel = (tile: DavinciTile): string => {
  const color = tile.color === 'BLACK' ? '검정' : '흰색'
  if (tile.number === null) return `${color} 감춘 타일`
  return `${color} ${tileLabel(tile)}`
}
