import type { ReactNode } from 'react'
import { cn } from '@/cn'
import type { CategoryScores, YachtCategory } from '@/domain/scoring'
import {
  UPPER_BONUS_POINTS,
  UPPER_BONUS_THRESHOLD,
  YACHT_LOWER_CATEGORIES,
  YACHT_UPPER_CATEGORIES,
} from '@/domain/scoring'
import type { PlayerId, ScoreBoard } from '@/realtime/wsEvents'
import { categoryLabel, isRecorded } from '@/yachtCategoryView'
import { CategoryIcon } from './CategoryIcon'
import { Tooltip } from './Tooltip'

export interface ScoreSheetPlayer {
  nickname: string
  playerId: PlayerId
  scoreboard: ScoreBoard | undefined
}

interface ScoreSheetProps {
  /** 지금 턴인 플레이어. 해당 열을 하이라이트한다. */
  activePlayerId?: PlayerId | undefined
  /** 현재 주사위로 얻을 수 있는 점수. 굴리기 전이면 비어 있다. */
  candidates: CategoryScores
  /** 내 열의 미기입 행을 탭하면 바로 기록할 수 있는 상태인지. */
  canPick: boolean
  className?: string
  /**
   * 표 위에 붙는 섹션 헤더. **이 컴포넌트 안으로 넣어야** 열 머리와 한 덩어리로 붙는다 —
   * 이 표는 자기 자신이 스크롤 컨테이너이자 섹션이라, 밖에서 한 번 더 감싸면 헤더가
   * 스크롤 영역 밖에 서고 그 사이에 여백이 생긴다.
   */
  header?: ReactNode
  onPick: (category: YachtCategory) => void
  players: ScoreSheetPlayer[]
  you: PlayerId
}

function scoreCell(value: number | null | undefined, preview: number | null, isPreview: boolean) {
  if (isPreview) return { className: 'bg-brand/15 text-brand-strong', content: preview }
  if (!isRecorded(value)) return { className: 'text-content-faint', content: '·' }
  return { className: value === 0 ? 'text-danger' : 'text-content', content: value }
}

/** 플레이어 머리글자 칩. 헤더·트레이에서도 같은 표기를 쓰도록 내보낸다. */
export function PlayerBadge({
  active = false,
  nickname,
  size = 'md',
}: {
  active?: boolean
  nickname: string
  size?: 'sm' | 'md'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full border font-bold',
        size === 'md' ? 'size-7 text-[11px]' : 'size-6 text-[10px]',
        active
          ? 'border-brand bg-brand text-on-brand'
          : 'border-border bg-surface text-content-muted',
      )}
      title={nickname}
    >
      {initialsOf(nickname)}
    </span>
  )
}

/**
 * 디자인 Yacht Play Screens의 점수시트 — 모든 플레이어를 열로 눕힌 한 장.
 * 내 열의 미기입 행에는 굴림 미리보기 점수가 뜨고, 행을 탭하면 바로 기록된다.
 */
export function ScoreSheet({
  activePlayerId,
  candidates,
  canPick,
  className,
  header,
  onPick,
  players,
  you,
}: ScoreSheetProps) {
  const rolled = Object.keys(candidates).length > 0
  const activePlayer = players.find((player) => player.playerId === activePlayerId)
  // 첫 열은 아이콘+한글 라벨("스몰 스트레이트")이 320px 2열에서도 잘리지 않을 폭.
  const columns = {
    gridTemplateColumns: `minmax(8rem, 1.3fr) repeat(${players.length}, minmax(2.75rem, 1fr))`,
  }

  const cellHighlight = (playerId: PlayerId) =>
    playerId === activePlayerId ? 'bg-surface' : undefined

  const renderCategoryRow = (category: YachtCategory) => {
    const activeRecorded = activePlayer?.scoreboard?.categories[category]
    const preview =
      activePlayer && !isRecorded(activeRecorded) && rolled ? (candidates[category] ?? 0) : null
    const clickable = activePlayerId === you && canPick && preview !== null

    const cells = players.map((player) => {
      const value = player.scoreboard?.categories[category]
      const isPreviewCell = player.playerId === activePlayerId && preview !== null
      const cell = scoreCell(value, preview, isPreviewCell)
      return (
        <span
          className={cn(
            'justify-self-stretch py-1 text-center font-mono text-[15px] font-bold tabular-nums',
            cellHighlight(player.playerId),
            cell.className,
          )}
          key={player.playerId}
        >
          {cell.content}
        </span>
      )
    })

    // grow shrink-0 basis-auto(= flex: 1 0 auto): 남을 때만 늘고, 모자라면 줄지 않고 스크롤한다.
    // flex-1(1 1 0%)로 두면 짧은 창에서 행이 44px 아래로 찌그러져 탭 타깃이 무너진다.
    // 이 세 class는 부모가 flex일 때만(wide 상시 패널) 의미가 있다 — 모바일 시트는 블록이라
    // 무시되고 행은 종전대로 44px 고정이다.
    const rowClassName = cn(
      'grid max-h-15 min-h-11 w-full shrink-0 grow basis-auto items-center gap-1 border-0 border-b border-border/40 bg-transparent px-3 text-left',
      clickable &&
        'cursor-pointer transition-colors hover:bg-brand/10 focus-visible:outline-3 focus-visible:outline-focus focus-visible:outline-offset-[-3px]',
    )
    const label = (
      <span className="flex min-w-0 items-center gap-1.5 text-[14px] font-semibold text-content">
        <CategoryIcon category={category} className="size-4 flex-none text-content-muted" />
        <span className="truncate">{categoryLabel[category]}</span>
      </span>
    )

    if (!clickable) {
      return (
        <div className={rowClassName} key={category} style={columns}>
          {label}
          {cells}
        </div>
      )
    }
    return (
      <button
        aria-label={`${categoryLabel[category]} ${preview}`}
        className={rowClassName}
        key={category}
        onClick={() => onPick(category)}
        style={columns}
        type="button"
      >
        {label}
        {cells}
      </button>
    )
  }

  const metaRow = (
    label: string,
    values: string[],
    options?: { achieved?: boolean[]; emphasis?: boolean },
  ) => {
    const emphasis = options?.emphasis ?? false
    return (
      <div
        className={cn(
          'grid shrink-0 grow basis-auto items-center gap-1 px-3',
          emphasis
            ? 'max-h-18 min-h-12 border-t-2 border-border'
            : 'max-h-12 min-h-8 border-y border-border bg-surface-sunken',
        )}
        style={columns}
      >
        <span
          className={cn(
            'truncate font-bold tracking-[0.08em] uppercase',
            emphasis ? 'text-[11px] text-content-muted' : 'text-[10.5px] text-content-muted',
          )}
        >
          {label}
        </span>
        {values.map((value, index) => (
          <span
            className={cn(
              'text-center font-mono font-bold tabular-nums',
              emphasis
                ? 'text-[20px] text-brand-strong'
                : options?.achieved?.[index]
                  ? // 보너스 달성 강조(QA S15P11A406-102) — 달성한 플레이어의 셀만 brand로 띄운다.
                    'text-[13px] text-brand-strong'
                  : 'text-[12px] text-content-muted',
              cellHighlight(players[index]?.playerId ?? ''),
            )}
            // biome-ignore lint/suspicious/noArrayIndexKey: 열 순서 = players 순서로 고정이다
            key={index}
          >
            {value}
          </span>
        ))}
      </div>
    )
  }

  return (
    <section
      aria-label="플레이어별 점수표"
      // overscroll-contain: 시트 스크롤이 끝에 닿아도 뒤 페이지로 번지지 않는다.
      className={cn('flex flex-col overflow-auto overscroll-contain', className)}
      // 표 안에 포커스 요소가 없을 수 있어 스크롤 컨테이너가 tab을 받아야 한다(WCAG 2.1.1).
      // biome-ignore lint/a11y/noNoninteractiveTabindex: 스크롤 영역은 포커스를 받아야 한다
      tabIndex={0}
    >
      {/* 섹션 헤더와 열 머리가 한 덩어리로 붙어 함께 고정된다. 둘을 따로 두면 스크롤할 때
          제목만 떠내려가거나, 바깥에서 감싼 헤더와 표 사이에 여백이 남는다. */}
      <div className="sticky top-0 z-sticky shrink-0 bg-canvas">
        {header}
        <div
          className="grid min-h-9 items-center gap-1 border-b border-border px-3"
          style={columns}
        >
          <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-[0.08em] text-content-muted uppercase">
            족보
            <Tooltip
              align="start"
              content="내 차례에 굴리면 내 열에 미리보기 점수가 떠요. 그 숫자를 탭하면 바로 기록됩니다."
              label="점수 기록 방법"
            />
          </span>
          {players.map((player) => (
            <span className="justify-self-center" key={player.playerId}>
              <PlayerBadge
                active={player.playerId === activePlayerId}
                nickname={player.nickname}
                size="sm"
              />
            </span>
          ))}
        </div>
      </div>

      {/* 행 묶음만 남는 높이를 나눠 갖는다 — 헤더까지 함께 가운데로 밀리면 안 된다.
          grow shrink-0 basis-auto: 남을 때만 늘고, 모자라면 줄지 않고 스크롤한다. */}
      <div className="flex shrink-0 grow basis-auto flex-col justify-center-safe">
        {YACHT_UPPER_CATEGORIES.map(renderCategoryRow)}
        {metaRow(
          `소계 / ${UPPER_BONUS_THRESHOLD}`,
          players.map((player) => String(player.scoreboard?.upperSubtotal ?? 0)),
          {
            achieved: players.map(
              (player) => (player.scoreboard?.upperSubtotal ?? 0) >= UPPER_BONUS_THRESHOLD,
            ),
          },
        )}
        {metaRow(
          `보너스 +${UPPER_BONUS_POINTS}`,
          players.map((player) =>
            (player.scoreboard?.upperBonus ?? 0) > 0 ? `+${UPPER_BONUS_POINTS}` : '—',
          ),
          { achieved: players.map((player) => (player.scoreboard?.upperBonus ?? 0) > 0) },
        )}
        {YACHT_LOWER_CATEGORIES.map(renderCategoryRow)}
        {metaRow(
          '합계',
          players.map((player) => String(player.scoreboard?.total ?? 0)),
          { emphasis: true },
        )}
      </div>
    </section>
  )
}

/** 한글 닉네임은 앞 두 글자, 라틴은 단어 머리글자. 디자인의 아바타 표기 규칙. */
function initialsOf(nickname: string) {
  if (/[가-힣]/.test(nickname)) return nickname.slice(0, 2)
  const parts = nickname.split(/[\s'’-]+/).filter(Boolean)
  const first = parts[0]?.[0] ?? nickname[0] ?? '?'
  const second = parts[1]?.[0] ?? ''
  return `${first}${second}`.toUpperCase()
}
