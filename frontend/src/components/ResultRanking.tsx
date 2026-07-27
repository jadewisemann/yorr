import { cn } from '@/cn'
import type { PlayerId } from '@/realtime/wsEvents'

export interface RankedPlayer {
  nickname: string
  playerId: PlayerId
  total: number
}

interface ResultRankingProps {
  className?: string
  players: RankedPlayer[]
  you: PlayerId
}

/**
 * ⑦ 최종 순위. 내 자리는 굵은 테두리 + "(나)" 라벨 2중으로 표시한다.
 * 1위 트로피 그래픽은 쓰지 않는다 — 등수 숫자와 점수로 충분하다.
 */
export function ResultRanking({ className, players, you }: ResultRankingProps) {
  return (
    <ol className={cn('grid list-none gap-2 p-0', className)}>
      {players.map((player, index) => {
        const mine = player.playerId === you
        return (
          <li
            className={cn(
              'flex min-h-[3.375rem] items-center gap-3 rounded-card px-3.5',
              mine ? 'border-2 border-brand bg-surface-raised' : 'border border-border bg-surface',
              index === 0 && !mine && 'bg-surface-raised',
            )}
            key={player.playerId}
          >
            <span className="w-6 flex-none font-mono text-[15px] font-bold text-content tabular-nums">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-content">
              {player.nickname}
              {mine && <span className="ml-1 font-bold text-brand-strong">(나)</span>}
            </span>
            <span className="flex-none font-mono text-[17px] font-bold text-content tabular-nums">
              {player.total}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
