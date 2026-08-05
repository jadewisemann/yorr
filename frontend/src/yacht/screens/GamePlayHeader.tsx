import type { Ref } from 'react'
import type { VoiceChat } from '@/realtime/voice/useVoiceChat'
import type { Player, PlayerId } from '@/realtime/wsEvents'
import { cn } from '@/shared/cn'
import { IconClose, IconHelp, IconMic, IconSound } from '@/shared/components/Icon'
import type { ConnectionStatus } from '@/store'
import { RoundTimer } from '@/yacht/components/RoundTimer'

const TOTAL_ROUNDS = 12

interface GamePlayHeaderProps {
  activePlayer: Player | undefined
  /** 오디오 말풍선이 붙을 자리. 소리 버튼에 꽂는다. */
  audioButtonRef?: Ref<HTMLButtonElement> | undefined
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
  ref,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  pressed?: boolean
  ref?: Ref<HTMLButtonElement> | undefined
}) {
  return (
    <button
      aria-label={label}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      className="grid size-tap flex-none cursor-pointer place-items-center rounded-card border border-border bg-surface text-content-muted transition-colors hover:text-content focus-ring"
      onClick={onClick}
      ref={ref}
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
      {/*
        320px에서는 이 칸에 56px만 남는다 — 고정 요소(나가기 44 · 도움말 44 · 소리 44 ·
        타이머 52 + 좌우 여백 32 + gap 60 = 276px)가 폭을 다 먹고 flex-1이 나머지를 받는다.
        「Round 01 / 12」는 넓은 자간까지 합쳐 약 110px이라 두 줄로 접혔다.

        그 폭에서는 `Round`와 넓은 자간을 뺀다. 숫자 쌍(01 / 12)만 남아도 옆의 원형 타이머와
        나란히 놓이면 라운드 진행으로 읽히고, 정확한 낭독은 위의 sr-only h1이 이미 한다
        (「요르 게임 진행 중 · N / 12 라운드」). nowrap을 함께 걸어 남은 폭이 더 줄어도
        접히는 대신 잘리게 한다 — 접히면 헤더 안에서 줄 수가 흔들린다.
      */}
      <span className="font-mono text-[11px] leading-none font-bold tracking-[0.16em] whitespace-nowrap text-content-muted tabular-nums uppercase max-tiny:tracking-normal">
        <span className="max-tiny:hidden">Round </span>
        {String(roundNumber).padStart(2, '0')} / {TOTAL_ROUNDS}
      </span>
      <span
        className={cn(
          'flex min-w-0 items-center gap-1.5 text-[16px] font-bold transition-colors duration-(--ds-motion-base) motion-safe:animate-turn-flash',
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
        {/*
          truncate는 글자를 가진 요소에 걸어야 한다 — flex 컨테이너에 걸면 text-overflow가
          익명 플렉스 아이템에 닿지 않아 말줄임 없이 그냥 잘린다. 320px에서 「내 턴이에요」가
          「내 턴이」로 끊겨 오작동처럼 읽혔다.

          그리고 이 칸은 320px에서 56px뿐이라(Round 라벨 주석의 계산) 말줄임을 붙여도 한 글자
          남는다 — 그 폭에서는 짧은 라벨로 바꿔 통째로 들어가게 한다. 정확한 상태는 위의
          sr-only h1과 트레이 안내문이 이미 말한다. 두 벌을 놓고 CSS로 고르는 이유: display:none
          쪽은 낭독되지 않으므로 보조기기도 보이는 것만 읽는다.
        */}
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

function turnStatusLabel(isMyTurn: boolean, submitted: boolean, activePlayerName?: string) {
  if (isMyTurn && !submitted) return '내 턴이에요'
  if (isMyTurn) return '제출 완료 · 대기 중'
  return activePlayerName ? `${activePlayerName}의 턴` : '턴 동기화 중'
}

/**
 * 320~359px용 짧은 라벨. 없는 정보를 만들지 않고 같은 사실을 짧게 말한다 —
 * 「제출 완료 · 대기 중」의 뒷말은 앞말에 이미 들어 있고, 남의 턴은 닉네임만으로도 읽힌다
 * (그 옆의 턴 점이 진행 중임을 말한다).
 */
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
    <span className="inline-flex h-[2.125rem] flex-none items-center gap-2 rounded-full border border-border bg-surface-veil px-3.5 text-[13px] font-semibold">
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
