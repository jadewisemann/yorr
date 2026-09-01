import { cn } from '@/shared/cn'
import { TOTAL_ROUNDS } from '@/yacht/domain/yachtGame'
import type { GamePlayHeaderProps } from './types'

function turnStatusLabel(isMyTurn: boolean, submitted: boolean, activePlayerName?: string) {
  if (isMyTurn && !submitted) return '내 턴이에요'
  if (isMyTurn) return '제출 완료 · 대기 중'
  return activePlayerName ? `${activePlayerName}의 턴` : '턴 동기화 중'
}

function shortTurnStatusLabel(isMyTurn: boolean, submitted: boolean, activePlayerName?: string) {
  if (isMyTurn && !submitted) return '내 턴'
  if (isMyTurn) return '제출 완료'
  return activePlayerName ?? '동기화 중'
}

function turnDotClass(isMyTurn: boolean, submitted: boolean, hasActivePlayer: boolean) {
  if (isMyTurn && !submitted) return 'bg-positive'
  if (hasActivePlayer) {
    return 'bg-brand-strong shadow-[0_0_8px_rgb(229_57_53_/_90%)] motion-safe:animate-ring-pulse'
  }
  return 'bg-content-faint'
}

export function TurnStatus({
  activePlayer,
  activePlayerId,
  isMyTurn,
  roundNumber,
  submitted,
  wide,
}: Pick<
  GamePlayHeaderProps,
  'activePlayer' | 'activePlayerId' | 'isMyTurn' | 'roundNumber' | 'submitted' | 'wide'
>) {
  return (
    <span className={cn('flex min-w-0 flex-col gap-1', !wide && 'flex-1')}>
      <span className="font-mono text-2xs leading-none font-bold tracking-[0.16em] whitespace-nowrap text-content-muted tabular-nums uppercase max-tiny:tracking-normal">
        <span className="max-tiny:hidden">Round </span>
        {String(roundNumber).padStart(2, '0')} / {TOTAL_ROUNDS}
      </span>
      <span
        className={cn(
          'flex min-w-0 items-center gap-1.5 text-base font-bold transition-colors duration-(--ds-motion-base) motion-safe:animate-turn-flash',
          !isMyTurn && activePlayer && 'text-brand-soft',
        )}
        key={activePlayerId ?? 'sync'}
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-2 flex-none rounded-full transition-colors duration-(--ds-motion-base)',
            turnDotClass(isMyTurn, submitted, activePlayer !== undefined),
          )}
        />
        <span className="truncate max-tiny:hidden">
          {turnStatusLabel(isMyTurn, submitted, activePlayer?.nickname)}
        </span>
        <span className="hidden truncate max-tiny:inline">
          {shortTurnStatusLabel(isMyTurn, submitted, activePlayer?.nickname)}
        </span>
      </span>
    </span>
  )
}
