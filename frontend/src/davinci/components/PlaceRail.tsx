import { Tile } from '@/davinci/components/Tile'
import type { DavinciTile } from '@/realtime/wsEvents'

interface PlaceRailProps {
  hand: readonly DavinciTile[]
  joker: DavinciTile
  onPlace: (index: number) => void
}

/**
 * 조커를 놓을 자리 고르기. 타일 사이사이의 틈이 그대로 버튼이다.
 *
 * 조커만 자리를 묻는 이유는 규칙이 그렇기 때문이다 — 나머지 타일은 오름차순 자리가
 * 하나로 정해져 서버가 알아서 넣는다. 여기서 어디에 넣느냐가 이 게임의 유일한
 * 거짓말이라, 화면도 손패 전체를 보여 주고 고르게 한다.
 */
export function PlaceRail({ hand, joker, onPlace }: PlaceRailProps) {
  return (
    <div className="grid gap-2.5">
      <p className="m-0 text-center text-game-content-muted text-sm">
        조커를 뽑았어요. 어느 자리에 넣을지 고르세요.
      </p>
      <div className="flex items-center justify-center gap-0.5 overflow-x-auto py-1">
        {Array.from({ length: hand.length + 1 }, (_, index) => (
          // 자리는 "그 자리 오른쪽 타일"로 식별한다. 맨 끝 자리에는 오른쪽 타일이 없다.
          <div className="flex items-center gap-0.5" key={hand[index]?.id ?? 'tail'}>
            <button
              aria-label={`${index + 1}번째 자리에 넣기`}
              className="h-16 w-6 rounded-chip border border-border-ghost border-dashed text-game-content-faint text-xs transition-colors pressable focus-ring hover:border-dv-accent hover:text-dv-accent"
              onClick={() => onPlace(index)}
              type="button"
            >
              ▾
            </button>
            {index < hand.length && hand[index] !== undefined && <Tile tile={hand[index]} />}
          </div>
        ))}
      </div>
      <p className="m-0 text-center font-mono text-2xs text-game-content-faint uppercase tracking-[0.18em]">
        {joker.color === 'BLACK' ? '검정' : '흰색'} 조커
      </p>
    </div>
  )
}
