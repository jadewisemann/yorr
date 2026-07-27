import { cn } from '@/cn'
import type { PlayerId } from '@/realtime/wsEvents'

export type PlayerProgress = 'done' | 'reconnecting' | 'rolling'

export interface PlayerProgressEntry {
  nickname: string
  playerId: PlayerId
  progress: PlayerProgress
}

interface PlayerProgressStripProps {
  className?: string
  players: PlayerProgressEntry[]
}

const progressLabel: Record<PlayerProgress, string> = {
  done: '완료',
  rolling: '굴리는 중',
  reconnecting: '재연결',
}

/** 5명 이상이면 칩이 뭉개지므로 스트립만 가로 스크롤한다. */
export function PlayerProgressStrip({ className, players }: PlayerProgressStripProps) {
  if (players.length === 0) return null

  return (
    // 칩에 포커스 가능한 요소가 없으므로 목록 자체를 tab 대상으로 둔다 —
    // 그러지 않으면 5명 이상일 때 밀려난 칩을 키보드로 볼 수 없다(WCAG 2.1.1).
    <ul
      aria-label="다른 플레이어 진행 상태"
      className={cn(
        'flex list-none gap-1.5 overflow-x-auto p-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: 스크롤 영역은 포커스를 받아야 한다
      tabIndex={0}
    >
      {players.map((player) => (
        <li
          className={cn(
            'min-w-0 flex-1 basis-20 rounded-control border px-1 py-1.5 text-center',
            player.progress === 'reconnecting'
              ? 'border-dashed border-border bg-surface-sunken'
              : 'border-border bg-surface',
          )}
          key={player.playerId}
        >
          <p className="truncate text-[10px] font-semibold text-content-muted">{player.nickname}</p>
          <p
            className={cn(
              'mt-0.5 text-[9.5px] font-bold',
              player.progress === 'done' ? 'text-positive' : 'text-content-faint',
            )}
          >
            {progressLabel[player.progress]}
          </p>
        </li>
      ))}
    </ul>
  )
}
