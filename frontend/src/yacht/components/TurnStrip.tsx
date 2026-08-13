import { PeerMicButton } from '@/realtime/voice/PeerMicButton'
import type { VoiceChat } from '@/realtime/voice/useVoiceChat'
import type { PlayerId, PlayerStatus } from '@/realtime/wsEvents'
import { cn } from '@/shared/cn'

export interface TurnStripPlayer {
  playerId: PlayerId
  nickname: string
  status: PlayerStatus
  total: number
}

interface TurnStripProps {
  players: TurnStripPlayer[]
  activePlayerId: PlayerId | undefined
  className?: string
  voice?: VoiceChat
  you: PlayerId
}

export function TurnStrip({ players, activePlayerId, className, voice, you }: TurnStripProps) {
  return (
    <ol
      aria-label="턴 순서"
      className={cn(
        'm-0 flex min-w-0 flex-none list-none gap-1.5 overflow-x-auto px-gutter py-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {players.map((player) => {
        const active = player.playerId === activePlayerId
        const mine = player.playerId === you
        const talking = voice?.speaking.has(player.playerId) ?? false
        return (
          <li className="min-w-[5.25rem] flex-1" key={player.playerId}>
            <span
              {...(active ? { 'aria-current': 'step' as const } : {})}
              className={cn(
                'grid gap-1 rounded-card border px-2.5 py-2',
                active
                  ? // 턴이 넘어오는 순간 카드가 한 번 튀어 "전환됐다"를 알린다(QA FND-7).
                    'border-brand bg-brand/12 shadow-[0_0_0_3px_rgb(229_57_53_/_16%)] motion-safe:animate-turn-pop'
                  : 'border-border bg-surface-raised',
                talking && 'outline-2 outline-positive outline-offset-1',
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-1.5 flex-none',
                    active ? 'rounded-xs bg-brand-strong' : 'rounded-full bg-content-faint',
                  )}
                />
                <span
                  className={cn(
                    'truncate text-xs font-semibold',
                    active ? 'text-brand-soft' : 'text-content-muted',
                  )}
                >
                  {player.nickname}
                  {mine && ' (나)'}
                </span>
                {player.status === 'offline' && (
                  <span className="flex-none rounded-full border border-warning/40 bg-warning/12 px-1.5 py-0.5 text-2xs/none font-bold text-warning">
                    연결 끊김
                  </span>
                )}
                {voice && (
                  <PeerMicButton className="ml-auto" playerId={player.playerId} voice={voice} />
                )}
              </span>
              <span
                className={cn(
                  'font-mono text-base leading-none font-bold tabular-nums',
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
