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
 *
 * 자리 버튼은 손패 타일만큼 크게 잡는다. 타일 사이의 얇은 선으로 그렸더니 실기 폭이
 * 24px이라 누를 곳인지 알아보기도, 엄지로 맞히기도 어려웠다.
 */
export function PlaceRail({ hand, joker, onPlace }: PlaceRailProps) {
  return (
    <div className="grid gap-2.5">
      <p className="m-0 flex items-center justify-center gap-2 text-game-content-muted text-sm">
        <Tile size="sm" tile={joker} />
        <span>조커를 뽑았어요. 어느 자리에 넣을지 고르세요.</span>
      </p>
      <div className="flex items-center justify-center gap-1 overflow-x-auto py-1">
        {Array.from({ length: hand.length + 1 }, (_, index) => (
          // 자리는 "그 자리 오른쪽 타일"로 식별한다. 맨 끝 자리에는 오른쪽 타일이 없다.
          <div className="flex shrink-0 items-center gap-1" key={hand[index]?.id ?? 'tail'}>
            <button
              aria-label={`${index + 1}번째 자리에 넣기`}
              className="grid h-16 w-11 place-items-center rounded-chip border border-dv-accent/45 border-dashed bg-dv-accent/10 font-bold text-dv-accent text-lg transition-colors pressable focus-ring hover:bg-dv-accent/20"
              onClick={() => onPlace(index)}
              type="button"
            >
              +
            </button>
            {index < hand.length && hand[index] !== undefined && <Tile tile={hand[index]} />}
          </div>
        ))}
      </div>
    </div>
  )
}
