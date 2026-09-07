import { cn } from '@/shared/cn'

export interface Seat {
  eliminated: boolean
  hidden: number
  id: string
  mine: boolean
  name: string
  turn: boolean
}

interface TurnOrderProps {
  seats: readonly Seat[]
}

/**
 * 차례가 도는 순서 한 줄. 자리마다 이름·감춘 타일 수를 달고, 지금 차례인 자리를 밝힌다.
 *
 * 손패 줄(`TileRack`)에도 같은 정보가 있지만 4인 판에서는 줄이 화면을 넘쳐 스크롤되고,
 * 그러면 "다음이 누구인가"를 한눈에 셀 수 없다. 이 띠는 언제나 위쪽에 남아 판 전체의
 * 상태표 역할을 한다 — 누가 탈락했고, 누가 몇 장 남았고, 차례가 어디까지 왔는가.
 */
export function TurnOrder({ seats }: TurnOrderProps) {
  return (
    <ol
      aria-label="차례 순서"
      className="m-0 flex list-none flex-wrap items-center gap-1 p-0 text-2xs"
    >
      {seats.map((seat, index) => (
        <li
          aria-current={seat.turn ? 'true' : undefined}
          aria-label={seatLabel(seat)}
          className="flex shrink-0 items-center gap-1"
          key={seat.id}
        >
          {index > 0 && (
            <span aria-hidden="true" className="text-game-content-faint">
              ›
            </span>
          )}
          <span
            className={cn(
              'inline-flex max-w-32 items-center gap-1.5 rounded-full border px-2 py-0.5 font-bold transition-colors',
              seat.turn
                ? 'border-dv-turn bg-dv-turn/15 text-dv-turn'
                : 'border-dv-line text-game-content-muted',
              seat.eliminated && 'line-through opacity-50',
            )}
          >
            <span className="truncate">{seat.mine ? `${seat.name} (나)` : seat.name}</span>
            <span className="shrink-0 font-mono tabular-nums">
              {seat.eliminated ? '탈락' : `${seat.hidden}장`}
            </span>
          </span>
        </li>
      ))}
    </ol>
  )
}

const seatLabel = (seat: Seat): string => {
  const who = seat.mine ? `${seat.name} (나)` : seat.name
  if (seat.eliminated) return `${who}, 탈락`
  return `${who}, 감춘 타일 ${seat.hidden}장${seat.turn ? ', 지금 차례' : ''}`
}
