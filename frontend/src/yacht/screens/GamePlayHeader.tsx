import { cn } from '@/shared/cn'
import { IconClose, IconHelp, IconMic, IconSound } from '@/shared/components/Icon'
import {
  audioLabel,
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
  voice,
  wide,
}: GamePlayHeaderProps) {
  const controls = (
    <>
      <HeaderButton label="게임 도움말" onClick={onHelp}>
        <IconHelp className="size-4.5" />
      </HeaderButton>
      {/*
        소리 버튼 하나가 오디오 전체(마이크·배경음·효과음)의 입구다. 버튼을 늘리지 않는 게
        핵심이다 — 320px 헤더는 ✕·턴표시·?·🔊·타이머로 이미 꽉 차서, 마이크를 따로 넣으면
        턴 표시가 한 글자씩 세로로 접힌다(실측). 트레이에 띄우면 주사위 위에 겹쳐 답답하다.
        마이크가 켜져 있으면 배지로 알려 시트를 열지 않고도 상태가 읽힌다.
      */}
      <HeaderButton
        label={audioLabel(soundMuted, voice)}
        onClick={onOpenAudio}
        pressed={voice.status === 'on'}
        ref={audioButtonRef}
      >
        {/* 아이콘 자체가 aria-hidden이다 — 버튼의 접근 가능한 이름은 HeaderButton의
            aria-label이 책임진다.
            마이크 배지는 초록으로 둔다 — 회색 소리 아이콘 위에 얹히므로 같은 색이면 배지가
            아이콘의 일부로 읽힌다. "지금 살아 있다"는 신호를 색으로도 준다(턴 점과 같은 규칙).
            LobbyPage 헤더의 오디오 버튼이 같은 조합을 쓴다. */}
        <span className="relative">
          <IconSound className="size-4.5" muted={soundMuted} />
          {voice.status === 'on' && (
            <IconMic className="absolute -top-1.5 -right-2 size-3 text-positive" />
          )}
        </span>
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
