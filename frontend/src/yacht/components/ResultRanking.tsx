import type { PlayerId } from '@/realtime/wsEvents'
import { cn } from '@/shared/cn'

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
    // 목록에 이름을 붙인다 — 옆의 제목은 "FINAL STANDINGS"라 낭독이 영문으로 튀고,
    // 스크롤되는 영역이라 이름이 있어야 보조기기에서 어디에 들어왔는지 알 수 있다.
    <ol aria-label="최종 순위" className={cn('grid list-none gap-2 p-0', className)}>
      {players.map((player, index) => {
        const mine = player.playerId === you
        const winner = index === 0
        return (
          <li
            className={cn(
              // 디자인 08 FINAL STANDINGS — 1위는 레드 틴트 + 글로우, 내 행은 밝은 보더.
              'flex min-h-[3.375rem] items-center gap-3 rounded-panel border px-3.5',
              winner
                ? 'border-brand/45 bg-brand/10 shadow-[0_0_0_3px_rgb(229_57_53_/_14%)]'
                : mine
                  ? 'border-white/22 bg-surface-raised'
                  : 'border-border bg-surface',
            )}
            key={player.playerId}
          >
            <span
              className={cn(
                'w-6 flex-none text-center font-mono text-base font-bold tabular-nums',
                winner ? 'text-brand-strong' : mine ? 'text-content' : 'text-content-faint',
              )}
            >
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-content">
              {player.nickname}
              {mine && <span className="ml-1 font-bold text-content-muted">(나)</span>}
              {winner && (
                <span className="ml-2 rounded-chip bg-brand/20 px-1.5 py-0.5 align-middle font-mono text-2xs font-bold tracking-[0.1em] text-brand-soft">
                  WIN
                </span>
              )}
            </span>
            <span
              className={cn(
                'flex-none font-mono text-lg font-bold tabular-nums',
                winner ? 'text-brand-strong' : 'text-content',
              )}
            >
              {player.total}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
