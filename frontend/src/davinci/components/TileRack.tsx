import { Tile } from '@/davinci/components/Tile'
import type { DavinciTile } from '@/realtime/wsEvents'
import { cn } from '@/shared/cn'

interface TileRackProps {
  eliminated?: boolean
  hidden: number
  mine?: boolean
  name: string
  onSelectTile?: ((tileId: string) => void) | undefined
  selectedTileId?: string | null | undefined
  tiles: readonly DavinciTile[]
  turn?: boolean
}

/**
 * 한 사람의 손패 한 줄. 이름·남은 감춘 수·타일이 한 덩어리다.
 *
 * 상대의 줄에서는 감춘 타일만 누를 수 있고(그것이 곧 추측 대상 지정이다), 내 줄은
 * 누를 수 없다 — 내 타일을 지목하는 일은 규칙에 없다.
 */
export function TileRack({
  eliminated = false,
  hidden,
  mine = false,
  name,
  onSelectTile,
  selectedTileId,
  tiles,
  turn = false,
}: TileRackProps) {
  return (
    <section
      className={cn(
        'grid gap-2 rounded-card border px-3 py-2.5 transition-colors',
        turn ? 'border-dv-turn/60 bg-dv-felt' : 'border-border bg-surface-veil',
        eliminated && 'opacity-55',
      )}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="m-0 truncate font-bold text-game-content text-sm">
          {mine ? `${name} (나)` : name}
        </h3>
        <p className="m-0 shrink-0 font-mono text-2xs text-game-content-faint uppercase tracking-[0.18em]">
          {eliminated ? '탈락' : `감춘 ${hidden}장`}
        </p>
      </header>
      <div className="flex flex-wrap items-end gap-1.5">
        {tiles.map((tile) => (
          <Tile
            key={tile.id}
            onSelect={onSelectTile && !tile.revealed ? () => onSelectTile(tile.id) : undefined}
            selected={selectedTileId === tile.id}
            size={mine ? 'md' : 'sm'}
            tile={tile}
          />
        ))}
      </div>
    </section>
  )
}
