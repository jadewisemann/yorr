import type { PlayerId, PlayerStatus } from '@/realtime/wsEvents'
import { cn } from '@/shared/cn'

export interface TurnStripPlayer {
  playerId: PlayerId
  nickname: string
  status: PlayerStatus
  total: number
}

interface TurnStripProps {
  /** 서버가 준 턴 순서대로 넘긴다. 이 순서 자체가 정보다. */
  players: TurnStripPlayer[]
  activePlayerId: PlayerId | undefined
  className?: string
  /** 음성 채팅에서 지금 말하고 있는 사람들. 통화를 끈 상태면 비어 있다. */
  speaking?: ReadonlySet<PlayerId>
  you: PlayerId
}

/**
 * 상단 진행 표시 — 누구 차례인지 1초 안에 읽히게 한다.
 * <p>
 * 이름을 그대로 노출하고 내 칩만 "나" 태그로 구분한다. 머리글자 원형 배지는 누가 누군지 읽히지 않았고,
 * 내 이름이 화면에서 사라지는 문제도 있었다. 하단의 "다음 턴을 기다리는 중" 문구는 이 표시로 대체한다.
 */
export function TurnStrip({
  players,
  activePlayerId,
  className,
  speaking,
  you,
}: TurnStripProps) {
  return (
    <ol
      aria-label="턴 순서"
      // 인원이 많아지면 가로로 밀어서 본다 — 줄바꿈으로 헤더 높이가 늘면 3D 트레이가 리사이즈된다.
      className={cn(
        'm-0 flex min-w-0 flex-none list-none gap-1.5 overflow-x-auto px-gutter py-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {players.map((player) => {
        const active = player.playerId === activePlayerId
        const mine = player.playerId === you
        const talking = speaking?.has(player.playerId) ?? false
        return (
          <li className="min-w-[5.25rem] flex-1" key={player.playerId}>
            <span
              // 스크린리더에도 "지금 이 사람 차례"가 전달되게 현재 항목을 표시한다.
              {...(active ? { 'aria-current': 'step' as const } : {})}
              className={cn(
                // 디자인 04의 턴 카드 — 위에 점·이름, 아래에 점수. 현재 턴만 레드 틴트로 뜬다.
                'grid gap-1 rounded-card border px-2.5 py-2',
                active
                  ? // 턴이 넘어오는 순간 카드가 한 번 튀어 "전환됐다"를 알린다(QA FND-7).
                    'border-brand bg-brand/12 shadow-[0_0_0_3px_rgb(229_57_53_/_16%)] motion-safe:animate-turn-pop'
                  : 'border-border bg-surface-raised',
                // 말하는 중은 outline으로 두른다 — 현재 턴이 shadow를 이미 쓰고 있어서
                // ring/shadow로 겹치면 둘이 서로를 덮는다. 색은 레드(턴)와 겹치지 않게 초록.
                talking && 'outline-2 outline-positive outline-offset-1',
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-1.5 flex-none',
                    active ? 'rounded-[2px] bg-brand-strong' : 'rounded-full bg-content-faint',
                  )}
                />
                <span
                  className={cn(
                    'truncate text-[12px] font-semibold',
                    active ? 'text-brand-soft' : 'text-content-muted',
                  )}
                >
                  {player.nickname}
                  {mine && ' (나)'}
                </span>
                {/* 초록 테두리만으로 알리지 않는다 — 색은 저대비·색각 이상에서 먼저 사라진다.
                    sr-only 텍스트까지 넣으면 말할 때마다 낭독돼 소음이 되므로 글리프만 둔다. */}
                {talking && (
                  <span aria-hidden="true" className="flex-none text-[10px] leading-none">
                    🎙️
                  </span>
                )}
                {player.status === 'offline' && (
                  <span className="flex-none rounded-full border border-warning/40 bg-warning/12 px-1.5 py-0.5 text-[9px]/none font-bold text-warning">
                    연결 끊김
                  </span>
                )}
              </span>
              <span
                className={cn(
                  'font-mono text-[17px] leading-none font-bold tabular-nums',
                  active ? 'text-white' : 'text-content',
                )}
              >
                {player.total}
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
