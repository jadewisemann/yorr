import { cn } from '@/shared/cn'
import { TOTAL_ROUNDS } from '@/yacht/domain/yachtGame'
import type { GamePlayHeaderProps } from './types'

export function turnStatusLabel(isMyTurn: boolean, submitted: boolean, activePlayerName?: string) {
  if (isMyTurn && !submitted) return '내 턴이에요'
  if (isMyTurn) return '제출 완료 · 대기 중'
  return activePlayerName ? `${activePlayerName}의 턴` : '턴 동기화 중'
}

/**
 * 320~359px용 짧은 라벨. 없는 정보를 만들지 않고 같은 사실을 짧게 말한다 —
 * 「제출 완료 · 대기 중」의 뒷말은 앞말에 이미 들어 있고, 남의 턴은 닉네임만으로도 읽힌다
 * (그 옆의 턴 점이 진행 중임을 말한다).
 */
export function shortTurnStatusLabel(
  isMyTurn: boolean,
  submitted: boolean,
  activePlayerName?: string,
) {
  if (isMyTurn && !submitted) return '내 턴'
  if (isMyTurn) return '제출 완료'
  return activePlayerName ?? '동기화 중'
}

export function turnDotClass(isMyTurn: boolean, submitted: boolean, hasActivePlayer: boolean) {
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
