import { cn } from '@/shared/cn'
import { AudioStatusIcon, audioLabel } from '@/shared/components/AudioStatusIcon'
import { IconClose, IconHelp } from '@/shared/components/Icon'
import {
  ConnectionIndicator,
  HeaderButton,
  HeaderStat,
} from '@/yacht/components/GamePlayHeader/HeaderParts'
import { TurnStatus } from '@/yacht/components/GamePlayHeader/TurnStatus'
import type { GamePlayHeaderProps } from '@/yacht/components/GamePlayHeader/types'
import { RoundTimer } from '@/yacht/components/RoundTimer'
import { TOTAL_ROUNDS } from '@/yacht/domain/yachtGame'

export function GamePlayHeader({
  activePlayer,
  activePlayerId,
  audioButtonRef,
  connectionStatus,
  isMyTurn,
  leaderLabel,
  onHelp,
  onLeave,
  onOpenAudio,
  remainingMs,
  roundNumber,
  soundMuted,
  submitted,
  wide,
}: GamePlayHeaderProps) {
  const controls = (
    <>
      <HeaderButton label="게임 도움말" onClick={onHelp}>
        <IconHelp className="size-4.5" />
      </HeaderButton>
      <HeaderButton
        label={audioLabel({ muted: soundMuted })}
        onClick={onOpenAudio}
        ref={audioButtonRef}
      >
        <AudioStatusIcon muted={soundMuted} />
      </HeaderButton>
      {remainingMs !== null && (
        <RoundTimer
          compact
          remainingMs={remainingMs}
          roundNumber={roundNumber}
          totalRounds={TOTAL_ROUNDS}
        />
      )}
    </>
  )

  return (
    <header
      className={cn(
        'flex flex-none items-center px-gutter',
        wide ? 'h-[4.5rem] gap-4 border-b border-border' : 'h-[4.25rem] gap-3',
      )}
    >
      <h1 className="sr-only">
        요르 게임 진행 중 · {roundNumber} / {TOTAL_ROUNDS} 라운드
      </h1>
      <HeaderButton label="나가기" onClick={onLeave}>
        <IconClose className="size-4.5" />
      </HeaderButton>
      <TurnStatus
        activePlayer={activePlayer}
        activePlayerId={activePlayerId}
        isMyTurn={isMyTurn}
        roundNumber={roundNumber}
        submitted={submitted}
        wide={wide}
      />
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
