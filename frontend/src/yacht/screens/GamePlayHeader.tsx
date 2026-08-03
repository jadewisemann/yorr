import type { VoiceChat } from '@/realtime/voice/useVoiceChat'
import type { Player, PlayerId } from '@/realtime/wsEvents'
import { cn } from '@/shared/cn'
import { IconClose, IconHelp, IconSound } from '@/shared/components/Icon'
import type { ConnectionStatus } from '@/store'
import { RoundTimer } from '@/yacht/components/RoundTimer'

const TOTAL_ROUNDS = 12

interface GamePlayHeaderProps {
  activePlayer: Player | undefined
  activePlayerId: PlayerId | undefined
  connectionStatus: ConnectionStatus
  isMyTurn: boolean
  leaderLabel: string
  onHelp: () => void
  onLeave: () => void
  /** 소리 버튼이 오디오 시트를 연다(토글이 아니다 — 음소거는 시트 안에 있다). */
  onOpenAudio: () => void
  remainingMs: number
  roundNumber: number
  soundMuted: boolean
  submitted: boolean
  /** 음성 채팅 상태. 마이크 버튼은 소리 토글과 같은 자리에 선다. */
  voice: VoiceChat
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
      >
        {/* 아이콘 자체가 aria-hidden이다 — 버튼의 접근 가능한 이름은 HeaderButton의
            aria-label이 책임진다. */}
        <span className="relative">
          <IconSound className="size-4.5" muted={soundMuted} />
          {voice.status === 'on' && (
            <span
              aria-hidden="true"
              className="absolute -top-2 -right-2.5 text-[11px] leading-none"
            >
              🎙️
            </span>
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

/** 시트를 열지 않고도 지금 상태가 읽히게 라벨에 소리·마이크를 함께 담는다. */
function audioLabel(soundMuted: boolean, voice: VoiceChat) {
  const sound = soundMuted ? '소리 꺼짐' : '소리 켜짐'
  if (voice.status === 'on') {
    const peers = voice.peers.length
    return `오디오 설정 · ${sound} · 마이크 켜짐${peers > 0 ? ` · ${peers}명 연결됨` : ''}`
  }
  return `오디오 설정 · ${sound} · 마이크 꺼짐`
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
      className="grid size-tap flex-none cursor-pointer place-items-center rounded-card border border-border bg-surface text-content-muted transition-colors hover:text-content focus-ring"
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
  wide,
}: Pick<
  GamePlayHeaderProps,
  'activePlayer' | 'activePlayerId' | 'isMyTurn' | 'roundNumber' | 'submitted' | 'wide'
>) {
  return (
    // narrow에서는 이 줄이 남는 폭을 먹어 오른쪽 컨트롤을 끝으로 민다(예전 감싸던 div의 역할).
    <span className={cn('flex min-w-0 flex-col gap-0.5', !wide && 'flex-1')}>
      <span className="font-mono text-[11px] leading-none font-bold tracking-[0.16em] text-content-muted tabular-nums uppercase">
        Round {String(roundNumber).padStart(2, '0')} / {TOTAL_ROUNDS}
      </span>
      <span
        className={cn(
          'flex items-center gap-1.5 truncate text-[16px] font-bold transition-colors duration-(--ds-motion-base) motion-safe:animate-turn-flash',
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
