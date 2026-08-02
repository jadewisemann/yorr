import { cn } from '@/cn'
import { RoundTimer } from '@/components/RoundTimer'
import type { Player, PlayerId } from '@/realtime/wsEvents'
import type { ConnectionStatus } from '@/store'

const TOTAL_ROUNDS = 12

interface GamePlayHeaderProps {
  activePlayer: Player | undefined
  activePlayerId: PlayerId | undefined
  connectionStatus: ConnectionStatus
  isMyTurn: boolean
  leaderLabel: string
  onHelp: () => void
  onLeave: () => void
  onToggleSound: () => void
  remainingMs: number
  roundNumber: number
  soundMuted: boolean
  submitted: boolean
  wide: boolean
}

export function GamePlayHeader({
  activePlayer,
  activePlayerId,
  connectionStatus,
  isMyTurn,
  leaderLabel,
  onHelp,
  onLeave,
  onToggleSound,
  remainingMs,
  roundNumber,
  soundMuted,
  submitted,
  wide,
}: GamePlayHeaderProps) {
  const controls = (
    <>
      <HeaderButton label="게임 도움말" onClick={onHelp}>
        ?
      </HeaderButton>
      <HeaderButton
        label={soundMuted ? '소리 켜기' : '소리 끄기'}
        onClick={onToggleSound}
        pressed={!soundMuted}
      >
        <span aria-hidden="true">{soundMuted ? '🔇' : '🔊'}</span>
      </HeaderButton>
      <RoundTimer
        compact
        remainingMs={remainingMs}
        roundNumber={roundNumber}
        totalRounds={TOTAL_ROUNDS}
      />
    </>
  )

  return (
    <header
      className={cn(
        'flex flex-none items-center px-gutter',
        wide ? 'h-[4.5rem] gap-5 border-b border-border' : 'h-[4.25rem] gap-3',
      )}
    >
      <h1 className="sr-only">
        요르 게임 진행 중 · {roundNumber} / {TOTAL_ROUNDS} 라운드
      </h1>
      <HeaderButton label="나가기" onClick={onLeave}>
        ✕
      </HeaderButton>
      <div className={cn('min-w-0', wide ? undefined : 'flex-1')}>
        <TurnStatus
          activePlayer={activePlayer}
          activePlayerId={activePlayerId}
          isMyTurn={isMyTurn}
          roundNumber={roundNumber}
          submitted={submitted}
        />
      </div>
      {wide ? (
        <>
          <span aria-hidden="true" className="h-8 w-px flex-none bg-border" />
          <HeaderStat label="선두" value={leaderLabel} />
          <span className="flex-1" />
          <ConnectionIndicator status={connectionStatus} />
          {controls}
        </>
      ) : (
        controls
      )}
    </header>
  )
}

function HeaderButton({
  children,
  label,
  onClick,
  pressed,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  pressed?: boolean
}) {
  return (
    <button
      aria-label={label}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      className="grid size-tap flex-none cursor-pointer place-items-center rounded-card border border-border bg-surface text-[15px] font-bold text-content-muted transition-colors hover:text-content focus-visible:outline-3 focus-visible:outline-focus"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  )
}

function TurnStatus({
  activePlayer,
  activePlayerId,
  isMyTurn,
  roundNumber,
  submitted,
}: Pick<
  GamePlayHeaderProps,
  'activePlayer' | 'activePlayerId' | 'isMyTurn' | 'roundNumber' | 'submitted'
>) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="font-mono text-[11px] leading-none font-bold tracking-[0.16em] text-content-muted tabular-nums uppercase">
        Round {String(roundNumber).padStart(2, '0')} / {TOTAL_ROUNDS}
      </span>
      <span
        className={cn(
          'flex items-center gap-1.5 truncate text-[16px] font-bold transition-colors duration-base motion-safe:animate-turn-flash',
          !isMyTurn && activePlayer && 'text-brand-soft',
        )}
        key={activePlayerId ?? 'sync'}
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-2 flex-none rounded-full transition-colors duration-base',
            turnDotClass(isMyTurn, submitted, activePlayer !== undefined),
          )}
        />
        {turnStatusLabel(isMyTurn, submitted, activePlayer?.nickname)}
      </span>
    </span>
  )
}

function turnStatusLabel(isMyTurn: boolean, submitted: boolean, activePlayerName?: string) {
  if (isMyTurn && !submitted) return '내 턴이에요'
  if (isMyTurn) return '제출 완료 · 대기 중'
  return activePlayerName ? `${activePlayerName}의 턴` : '턴 동기화 중'
}

function turnDotClass(isMyTurn: boolean, submitted: boolean, hasActivePlayer: boolean) {
  if (isMyTurn && !submitted) return 'bg-positive'
  if (hasActivePlayer) {
    return 'bg-brand-strong shadow-[0_0_8px_rgb(229_57_53_/_90%)] motion-safe:animate-ring-pulse'
  }
  return 'bg-content-faint'
}

function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const connected = status === 'connected'
  const label = {
    closed: '연결 끊김',
    connected: '연결됨',
    connecting: '연결 중',
    idle: '연결 중',
    reconnecting: '재연결 중',
  }[status]

  return (
    <span className="inline-flex h-[2.125rem] flex-none items-center gap-2 rounded-full border border-border bg-white/6 px-3.5 text-[13px] font-semibold">
      <span
        aria-hidden="true"
        className={cn('size-[7px] rounded-full', connected ? 'bg-positive' : 'bg-warning')}
      />
      {label}
    </span>
  )
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[10px] font-medium tracking-[0.08em] text-content-faint uppercase">
        {label}
      </span>
      <span className="text-[17px] font-bold text-content">{value}</span>
    </div>
  )
}
