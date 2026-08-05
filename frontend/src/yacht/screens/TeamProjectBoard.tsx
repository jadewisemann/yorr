import { useEffect, useState } from 'react'
import type { Player } from '@/realtime/wsEvents'
import { cn } from '@/shared/cn'
import { Button } from '@/shared/components/Button'
import { Dice } from '@/yacht/components/Dice'
import { ScoreSheet } from '@/yacht/components/ScoreSheet'
import { createDiceSet, type DiceValue } from '@/yacht/domain/dice'
import { calculateScoreCandidates, type YachtCategory } from '@/yacht/domain/scoring'
import { keepBounds, type TeamYachtView } from '@/yacht/domain/teamProject'
import { categoryLabel } from '@/yacht/yachtCategoryView'

/** 점수판이 한 장뿐이라 점수시트의 열도 하나다 — 그 열의 가짜 playerId. */
const TEAM_COLUMN = 'team'

const RUNNER_LABEL = ['1번 주자', '2번 주자', '3번 주자']

/** 주사위 다섯 자리. 자리 번호가 곧 주사위의 정체다 — 가려진 자리도 자리는 그대로 있다. */
const DIE_SLOTS = [0, 1, 2, 3, 4] as const

interface TeamProjectBoardProps {
  busy: boolean
  onKeep: (picks: number[]) => void
  onRoll: () => void
  onVote: (category: YachtCategory) => void
  players: Player[]
  view: TeamYachtView
  you: string
}

/**
 * 조별과제 야트 진행 화면(S15P11A406-209).
 *
 * 일반 야추의 `GamePlay`를 쓰지 않는다. 저 화면은 "한 사람이 세 번 굴리고 자기 점수판에
 * 기록한다"는 전제 위에 서 있어(rollCount·activePlayerId·round.submit), 순차 킵·가려진
 * 주사위·다수결 투표를 끼워 넣으려면 그 전제를 전부 뚫어야 한다. 일반 야추를 지키는 값이
 * 화면 한 장을 새로 그리는 값보다 크다.
 */
export function TeamProjectBoard({
  busy,
  onKeep,
  onRoll,
  onVote,
  players,
  view,
  you,
}: TeamProjectBoardProps) {
  // 킵 선택은 그 주자의 그 단계에서만 유효하다. 라운드·주자·단계가 바뀌면 렌더 시점에 버린다 —
  // 효과로 비우면 한 프레임 동안 남의 선택이 그려진다.
  const legKey = `${view.round}:${view.leg}:${view.stage}`
  const [selection, setSelection] = useState({ legKey, picks: [] as number[] })
  const picks = selection.legKey === legKey ? selection.picks : []
  // 룰렛 연출을 이미 본 라운드. 상태가 다시 와도 같은 룰렛을 두 번 돌리지 않는다.
  const [seenRoulette, setSeenRoulette] = useState(0)

  const runner = view.runnerId === you
  const mySeat = view.seats.indexOf(you)
  const bounds = keepBounds(view.leg, view.kept)
  const keeping = view.stage === 'KEEP' && runner
  const myVote = view.votes[you]
  const roulette =
    view.last?.rouletteCandidates && view.last.round > seenRoulette ? view.last : null

  const toggle = (index: number) => {
    const next = picks.includes(index)
      ? picks.filter((picked) => picked !== index)
      : [...picks, index].slice(-bounds.max)
    setSelection({ legKey, picks: next })
  }

  return (
    <div className="grid gap-4">
      {roulette?.rouletteCandidates ? (
        <RouletteOverlay
          candidates={roulette.rouletteCandidates}
          onDone={() => setSeenRoulette(roulette.round)}
          picked={roulette.category}
          score={roulette.score}
        />
      ) : null}

      <header className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 font-mono text-[11px] font-bold tracking-[0.16em] text-content-muted uppercase">
          조별과제 · 라운드 {view.round}/{view.rounds}
        </p>
        <p className="m-0 text-[13px] text-content-muted">
          내 순서 {mySeat >= 0 ? RUNNER_LABEL[mySeat] : '관전'}
        </p>
      </header>

      <SeatStrip players={players} view={view} />
      <DiceRow keeping={keeping} onToggle={toggle} picks={picks} view={view} />

      <p className="m-0 min-h-10 text-center text-sm text-content-muted">
        {guide({ bounds, busy, keeping, myVote, picks, runner, view })}
      </p>

      <StageAction
        bounds={bounds}
        busy={busy}
        keeping={keeping}
        onKeep={() => onKeep(picks)}
        onRoll={onRoll}
        picks={picks}
        runnerName={nicknameOf(players, view.runnerId)}
        runner={runner}
        stage={view.stage}
      />

      <ScoreSheet
        activePlayerId={TEAM_COLUMN}
        candidates={voteCandidates(view)}
        canPick={view.stage === 'VOTE' && !myVote}
        header={
          <p className="m-0 px-3 py-2 text-[12px] text-content-muted">
            {voteHeader(view.stage, myVote)}
          </p>
        }
        onPick={onVote}
        players={[{ nickname: '우리 팀', playerId: TEAM_COLUMN, scoreboard: view.board }]}
        you={TEAM_COLUMN}
      />
    </div>
  )
}

/** 이번 라운드의 주자 순서와 각자의 표. 순서는 라운드마다 한 칸 로테이션된다. */
function SeatStrip({ players, view }: { players: Player[]; view: TeamYachtView }) {
  return (
    <ol className="m-0 grid list-none grid-cols-3 gap-1.5 p-0">
      {view.seats.map((seat, index) => {
        const vote = view.votes[seat]
        return (
          <li
            className={cn(
              'grid gap-0.5 rounded-card border px-2 py-1.5 text-center',
              index === view.leg && view.stage !== 'VOTE'
                ? 'border-brand bg-brand/12'
                : 'border-border bg-surface',
            )}
            key={seat}
          >
            <span className="font-mono text-[10px] font-bold tracking-[0.12em] text-content-muted uppercase">
              {RUNNER_LABEL[index]}
            </span>
            <span className="truncate text-[13px] font-bold">{nicknameOf(players, seat)}</span>
            {vote ? (
              <span className="truncate text-[11px] text-brand-strong">{categoryLabel[vote]}</span>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

function DiceRow({
  keeping,
  onToggle,
  picks,
  view,
}: {
  keeping: boolean
  onToggle: (index: number) => void
  picks: number[]
  view: TeamYachtView
}) {
  return (
    <div className="flex justify-center gap-2">
      {DIE_SLOTS.map((slot) => {
        const face = view.dice[slot] ?? null
        if (face === null) return <HiddenDie key={slot} />
        const kept = view.kept[slot] === true
        return (
          <button
            aria-label={`주사위 ${slot + 1}`}
            aria-pressed={picks.includes(slot)}
            className={cn(
              'rounded-[18%] border-2 focus-ring',
              picks.includes(slot) ? 'border-brand-strong' : 'border-transparent',
              keeping && !kept ? 'cursor-pointer' : 'cursor-default',
            )}
            disabled={!keeping || kept}
            key={slot}
            onClick={() => onToggle(slot)}
            type="button"
          >
            <Dice held={kept} value={face as DiceValue} />
          </button>
        )
      })}
    </div>
  )
}

/** 굴리기·킵 확정. 투표 단계에는 버튼이 없다 — 점수시트의 행이 곧 투표 버튼이다. */
function StageAction({
  bounds,
  busy,
  keeping,
  onKeep,
  onRoll,
  picks,
  runner,
  runnerName,
  stage,
}: {
  bounds: { max: number; min: number }
  busy: boolean
  keeping: boolean
  onKeep: () => void
  onRoll: () => void
  picks: number[]
  runner: boolean
  runnerName: string
  stage: TeamYachtView['stage']
}) {
  if (stage === 'ROLL') {
    return (
      <Button disabled={!runner || busy} onClick={onRoll} size="cta">
        {runner ? '굴리기' : `${runnerName} 차례`}
      </Button>
    )
  }
  if (stage !== 'KEEP') return null
  return (
    <Button
      disabled={!keeping || busy || picks.length < bounds.min || picks.length > bounds.max}
      onClick={onKeep}
      size="cta"
    >
      {keeping ? `킵 확정 (${picks.length}/${bounds.max})` : `${runnerName}가 킵하는 중`}
    </Button>
  )
}

/** 룰렛이 한 칸씩 옮겨 가는 간격(ms)과 멈추기까지의 걸음 수. */
const ROULETTE_TICK_MS = 110
const ROULETTE_TICKS = 16
const ROULETTE_HOLD_MS = 1_400

/**
 * 동표(1:1:1) 룰렛 연출.
 *
 * ⭐ <b>결과는 서버가 이미 정했다</b>(`picked`). 여기서 도는 하이라이트는 연출일 뿐이고
 * 멈추는 자리는 항상 `picked`다 — 애니메이션이 결과를 뽑으면 클라이언트마다 다른 족보에
 * 멈춰 세 사람이 서로 다른 점수판을 보게 된다.
 */
function RouletteOverlay({
  candidates,
  onDone,
  picked,
  score,
}: {
  candidates: YachtCategory[]
  onDone: () => void
  picked: YachtCategory
  score: number
}) {
  const [step, setStep] = useState(0)
  const landed = step >= ROULETTE_TICKS
  const highlight = landed ? candidates.indexOf(picked) : step % candidates.length

  useEffect(() => {
    if (landed) {
      const timeoutId = window.setTimeout(onDone, ROULETTE_HOLD_MS)
      return () => window.clearTimeout(timeoutId)
    }
    const intervalId = window.setInterval(() => setStep((current) => current + 1), ROULETTE_TICK_MS)
    return () => window.clearInterval(intervalId)
  }, [landed, onDone])

  return (
    <div
      aria-live="polite"
      className="fixed inset-0 z-modal grid place-items-center bg-black/70 px-gutter"
      role="status"
    >
      <div className="grid w-full max-w-sm gap-4 rounded-panel border border-border bg-surface p-6 text-center">
        <p className="m-0 font-mono text-[11px] font-bold tracking-[0.16em] text-content-muted uppercase">
          투표 1:1:1 — 룰렛
        </p>
        <div className="grid gap-2">
          {candidates.map((category, index) => (
            <span
              className={cn(
                'rounded-card border px-3 py-2 text-sm font-bold transition-colors',
                index === highlight
                  ? 'border-brand bg-brand/20 text-brand-strong'
                  : 'border-border bg-surface-sunken text-content-muted',
              )}
              key={category}
            >
              {categoryLabel[category]}
            </span>
          ))}
        </div>
        <p className="m-0 min-h-6 text-sm text-content">
          {landed ? `${categoryLabel[picked]} · ${score}점 기록` : '돌리는 중…'}
        </p>
      </div>
    </div>
  )
}

/**
 * 앞 주자가 버린 주사위. 눈이 없는 게 아니라 <b>서버가 값을 보내지 않았다</b> —
 * 무엇을 버렸는지는 알 수 없다는 규칙이 이 자리에서 지켜진다.
 */
function HiddenDie() {
  return (
    <div
      aria-label="가려진 주사위"
      className="grid size-18 place-items-center rounded-[18%] border border-dashed border-border bg-surface-sunken p-3 font-mono text-2xl font-bold text-content-faint"
      role="img"
    >
      ?
    </div>
  )
}

/** 투표 단계에는 다섯 개가 모두 공개되므로 후보 점수를 그릴 수 있다. */
function voteCandidates(view: TeamYachtView) {
  if (view.stage !== 'VOTE') return {}
  const faces = DIE_SLOTS.map((slot) => view.dice[slot])
  if (faces.some((face) => face === null || face === undefined)) return {}
  return calculateScoreCandidates(createDiceSet(faces as number[]), recordedCategories(view.board))
}

function voteHeader(stage: TeamYachtView['stage'], myVote: YachtCategory | undefined) {
  if (stage !== 'VOTE') return '팀이 함께 쓰는 점수판'
  return myVote
    ? `${categoryLabel[myVote]}에 투표했어요. 2표를 받은 칸에 기록돼요`
    : '기록할 족보를 골라 투표하세요 — 2표를 받은 칸에 기록돼요'
}

function guide({
  bounds,
  busy,
  keeping,
  myVote,
  picks,
  runner,
  view,
}: {
  bounds: { max: number; min: number }
  busy: boolean
  keeping: boolean
  myVote: YachtCategory | undefined
  picks: number[]
  runner: boolean
  view: TeamYachtView
}) {
  if (busy) return '보내는 중이에요'
  if (view.stage === 'VOTE') {
    return `투표 ${Object.keys(view.votes).length}/3${myVote ? ' — 세 표가 모이면 기록돼요' : ''}`
  }
  if (keeping) {
    return bounds.min === bounds.max
      ? `${bounds.min}개를 킵하세요 (선택 ${picks.length}개)`
      : `${bounds.min}~${bounds.max}개를 킵하세요 (선택 ${picks.length}개) — 다음 주자가 굴릴 주사위를 남겨야 해요`
  }
  if (view.stage === 'ROLL' && runner) {
    return view.leg === 0 ? '5개를 전부 굴립니다' : '앞 주자가 킵한 눈만 보여요. 나머지를 굴립니다'
  }
  return '앞 주자가 킵한 눈만 공개돼요'
}

function recordedCategories(board: TeamYachtView['board']) {
  return (Object.keys(board.categories) as YachtCategory[]).filter(
    (category) => board.categories[category] !== null,
  )
}

function nicknameOf(players: Player[], playerId: string | null | undefined) {
  return players.find((player) => player.playerId === playerId)?.nickname ?? '팀원'
}
