import { cn } from '@/cn'
import type { PlayerId } from '@/realtime/wsEvents'

export interface TurnStripPlayer {
  playerId: PlayerId
  nickname: string
  total: number
}

interface TurnStripProps {
  /** 서버가 준 턴 순서대로 넘긴다. 이 순서 자체가 정보다. */
  players: TurnStripPlayer[]
  activePlayerId: PlayerId | undefined
  className?: string
  you: PlayerId
}

/**
 * 상단 진행 표시 — 누구 차례인지 1초 안에 읽히게 한다.
 * <p>
 * 이름을 그대로 노출하고 내 칩만 "나" 태그로 구분한다. 머리글자 원형 배지는 누가 누군지 읽히지 않았고,
 * 내 이름이 화면에서 사라지는 문제도 있었다. 하단의 "다음 턴을 기다리는 중" 문구는 이 표시로 대체한다.
 */
export function TurnStrip({ players, activePlayerId, className, you }: TurnStripProps) {
  const activePlayer = players.find((player) => player.playerId === activePlayerId)

  return (
    <div className={cn('flex flex-none items-center border-b border-border', className)}>
      <ol
        aria-label="턴 순서"
        // 인원이 많아지면 가로로 밀어서 본다 — 줄바꿈으로 헤더 높이가 늘면 3D 트레이가 리사이즈된다.
        className="m-0 flex min-w-0 flex-1 list-none gap-1.5 overflow-x-auto px-gutter py-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {players.map((player, index) => {
          const active = player.playerId === activePlayerId
          const mine = player.playerId === you
          return (
            <li className="flex-none" key={player.playerId}>
              <span
                // 스크린리더에도 "지금 이 사람 차례"가 전달되게 현재 항목을 표시한다.
                {...(active ? { 'aria-current': 'step' as const } : {})}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap',
                  active
                    ? 'border-brand bg-brand text-on-brand'
                    : 'border-border bg-surface text-content-muted',
                  mine && !active && 'border-content text-content',
                )}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="size-1.5 flex-none rounded-full bg-current opacity-90"
                  />
                )}
                <span className="font-mono tabular-nums opacity-70">{index + 1}</span>
                <span className="max-w-24 truncate">{player.nickname}</span>
                {mine && (
                  <span
                    className={cn(
                      'rounded-sm px-1 text-[9px] font-bold tracking-[0.06em]',
                      active ? 'bg-on-brand/20' : 'bg-surface-sunken text-content-muted',
                    )}
                  >
                    나
                  </span>
                )}
                <span className="font-mono tabular-nums">{player.total}</span>
              </span>
            </li>
          )
        })}
      </ol>
      <p className="m-0 flex-none px-gutter text-[11px] font-semibold text-content-muted">
        {activePlayer
          ? activePlayer.playerId === you
            ? '내 차례'
            : `${activePlayer.nickname} 차례`
          : '턴 동기화 중'}
      </p>
    </div>
  )
}
