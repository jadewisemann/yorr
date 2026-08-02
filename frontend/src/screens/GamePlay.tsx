import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/cn'
import { Button } from '@/components/Button'
import { ConnectionBanner } from '@/components/ConnectionBanner'
import { GameHelpModal } from '@/components/GameHelpModal'
import { Modal } from '@/components/Modal'
import { RecordPanel } from '@/components/RecordPanel'
import { ScoreSheet } from '@/components/ScoreSheet'
import { ToastHost, useToast } from '@/components/ToastHost'
import { TurnStrip } from '@/components/TurnStrip'
import type { DiceIndex } from '@/domain/dice'
import {
  type CategoryScores,
  calculateScoreCandidates,
  YACHT_CATEGORIES,
  type YachtCategory,
} from '@/domain/scoring'
import { MAX_ROLLS, type YachtGameAction } from '@/domain/yachtGame'
import { setSoundtrackMuted } from '@/landingSoundtrack'
import type { RoomSnapshot } from '@/realtime/wsEvents'
import { readSoundMuted, saveSoundMuted } from '@/soundPreference'
import { type ActiveRoomSession, useAppStore } from '@/store'
import { useCountdown } from '@/useCountdown'
import { useMediaQuery } from '@/useMediaQuery'
import { categoryLabel, categoryShortLabel, isRecorded } from '@/yachtCategoryView'
import { GameDiceTray } from './GameDiceTray'
import { GamePlayHeader } from './GamePlayHeader'
import { toMatrixPlayers, toTurnStripPlayers } from './gamePlayModel'
import { useGamePlayRoll } from './useGamePlayRoll'
import { useGamePlaySubmission } from './useGamePlaySubmission'

/** 이 폭부터 점수표를 시트 대신 좌측 상시 패널로 승격한다(와이어프레임 1c). */
const WIDE_LAYOUT = '(min-width: 1024px)'
interface GamePlayProps {
  roomId: string
  session: ActiveRoomSession
  snapshot: RoomSnapshot
  /** 헤더의 '나가기'가 눌리면 부모(GamePage)가 확인 모달을 연다. */
  onLeaveRequest: () => void
}

export function GamePlay({ onLeaveRequest, roomId, session, snapshot }: GamePlayProps) {
  const wide = useMediaQuery(WIDE_LAYOUT)
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const { message: toastMessage, showToast } = useToast()

  const [sheetOpen, setSheetOpen] = useState(false)
  const [zeroConfirm, setZeroConfirm] = useState<YachtCategory | null>(null)
  // 내 차례 시작 콜아웃 — 토스트보다 눈에 띄는 족보 이펙트와 같은 연출로 알린다. id = 리마운트 키.
  const [turnCallout, setTurnCallout] = useState<number | null>(null)
  const [soundMuted, setSoundMuted] = useState(readSoundMuted)
  // 닫은 안내가 "어느 상태의 안내였는지"를 담는다. boolean으로 두면 상태가 바뀌어도 계속 닫혀
  // 새 안내를 놓친다 — 값이 달라지는 순간 자동으로 다시 뜨게 하려는 의도다.
  const [helpOpen, setHelpOpen] = useState(false)

  const game = snapshot.game
  const roundNumber = game?.roundNumber ?? 1
  const activePlayerId = game?.activePlayerId
  const isMyTurn = activePlayerId === session.you
  const activePlayer = snapshot.players.find((player) => player.playerId === activePlayerId)
  const remainingMs = useCountdown(game?.roundDeadline ?? null)
  const myBoard = game?.scores[session.you]
  const activeBoard = activePlayerId ? game?.scores[activePlayerId] : undefined

  const roll = useGamePlayRoll({
    game,
    roomId,
    showToast,
    you: session.you,
  })
  const {
    canHold,
    canPick,
    canRoll,
    dispatch,
    keptCount,
    local,
    releaseAll,
    roll: handleRoll,
    rolling,
    setMuted: setRollMuted,
    submitted,
    submitting,
  } = roll
  const activePlayerRef = useRef(activePlayerId)
  useEffect(() => {
    if (activePlayerRef.current === activePlayerId) return
    activePlayerRef.current = activePlayerId
    setZeroConfirm(null)
    // 남의 턴을 구경하며 열어둔 점수시트가 턴이 넘어간 뒤에도 남아있으면 안 된다(QA FND-5).
    setSheetOpen(false)
  }, [activePlayerId])

  const closeSheet = useCallback(() => setSheetOpen(false), [])
  const { submitCategory } = useGamePlaySubmission({
    activePlayerId,
    dice: local.dice,
    dispatch,
    myBoard,
    onSucceeded: closeSheet,
    roomId,
    roundNumber,
    showToast,
    you: session.you,
  })

  const usedCategories = YACHT_CATEGORIES.filter((category) =>
    isRecorded(activeBoard?.categories[category]),
  )
  const candidates: CategoryScores = local.dice
    ? calculateScoreCandidates(local.dice, usedCategories)
    : {}
  const rolled = local.dice !== null

  // 디자인의 한 장 점수시트 — 모든 플레이어를 열로 눕힌다. 내 열이 항상 첫 번째다.
  const sheetPlayers = toMatrixPlayers(snapshot.players, game?.scores, session.you)
  const leaderLabel = scoreLeaderLabel(sheetPlayers)

  const toggleSound = () => {
    const muted = !soundMuted
    setSoundMuted(muted)
    saveSoundMuted(muted)
    setRollMuted(muted)
    setSoundtrackMuted(muted)
  }

  // 점수표 행·퀵 칩 공용 원큐 기록. 0점만 잃는 선택이라 확인 모달을 거친다.
  const pickCategory = (category: YachtCategory) => {
    if (!canPick) return
    if ((candidates[category] ?? 0) === 0) {
      setZeroConfirm(category)
      return
    }
    submitCategory(category)
  }

  // 마지막 굴림이 끝나면 족보 시트를 자동으로 연다(1d 인터랙션 명세).
  useEffect(() => {
    if (wide || submitted) return
    if (local.phase === 'choosing' && local.rollCount >= MAX_ROLLS) setSheetOpen(true)
  }, [local.phase, local.rollCount, submitted, wide])

  useMyTurnAlert({
    isMyTurn: isMyTurn && !submitted,
    onAlert: () => {
      // 하단 토스트는 시선 밖이라 놓치기 쉽다 — 족보 이펙트와 같은 대형 콜아웃으로 알린다.
      setTurnCallout(Date.now())
      vibrateForMyTurn()
    },
  })

  useRoundStartNotice({
    roundNumber,
    onNotice: () => {
      // 내 턴 시작은 useMyTurnAlert가 이미 알린다 — 여기선 관전 중일 때만 띄운다.
      if (isMyTurn || !activePlayer) return
      showToast(`라운드 ${roundNumber} 시작 — ${activePlayer.nickname}의 턴이에요`)
    },
  })

  useShortcuts(wide && isMyTurn, { onRoll: handleRoll, dispatch })

  // 상단 진행 표시 — 서버가 준 턴 순서 그대로다(명단 순서는 턴 순서가 아니다).
  const turnPlayers = toTurnStripPlayers(snapshot.players, game?.turnOrder, game?.scores)
  const turnStrip = (
    <TurnStrip activePlayerId={activePlayerId} players={turnPlayers} you={session.you} />
  )

  const diceScene = (
    <GameDiceTray
      activePlayer={activePlayer}
      isMyTurn={isMyTurn}
      onTurnCalloutDone={() => setTurnCallout(null)}
      roll={roll}
      roundNumber={roundNumber}
      turnCallout={turnCallout}
      wide={wide}
    />
  )

  const header = (
    <GamePlayHeader
      activePlayer={activePlayer}
      activePlayerId={activePlayerId}
      connectionStatus={connectionStatus}
      isMyTurn={isMyTurn}
      leaderLabel={leaderLabel}
      onHelp={() => setHelpOpen(true)}
      onLeave={onLeaveRequest}
      onToggleSound={toggleSound}
      remainingMs={remainingMs}
      roundNumber={roundNumber}
      soundMuted={soundMuted}
      submitted={submitted}
      wide={wide}
    />
  )

  const zeroModal = (
    <ZeroScoreModal
      category={zeroConfirm}
      onCancel={() => setZeroConfirm(null)}
      onConfirm={() => {
        const category = zeroConfirm
        setZeroConfirm(null)
        if (category) submitCategory(category)
      }}
    />
  )

  // 디자인의 quick chips — 열린 족보를 고정 순서로 눕히고 탭 한 번에 기록한다.
  const openCategories = YACHT_CATEGORIES.filter(
    (category) => !isRecorded(activeBoard?.categories[category]),
  )

  const quickStrip = (
    <QuickCategoryStrip
      canPick={canPick}
      candidates={candidates}
      categories={openCategories}
      onPick={pickCategory}
      rolled={rolled}
    />
  )

  // 킵 레일을 통째로 비우는 보조 동작(디자인 Yacht Play 3D의 Release all).
  const canReleaseAll = keptCount > 0 && canHold

  // 기록은 점수표·칩 탭으로 끝나므로 CTA는 굴리기 하나다(디자인 하단 바).
  const actions = (
    <GamePlayActions
      activePlayerName={activePlayer?.nickname}
      canReleaseAll={canReleaseAll}
      canRoll={canRoll}
      isMyTurn={isMyTurn}
      onReleaseAll={releaseAll}
      onRoll={handleRoll}
      rolling={rolling}
      submitted={submitted}
      submitting={submitting}
      wide={wide}
    />
  )

  const scoreSheet = (className: string) => (
    <ScoreSheet
      activePlayerId={activePlayerId}
      candidates={candidates}
      canPick={canPick}
      className={className}
      onPick={pickCategory}
      players={sheetPlayers}
      you={session.you}
    />
  )

  const activePlayerName = activePlayer?.nickname
  const sheetHint = scoreSheetHint(isMyTurn, rolled, activePlayerName)
  const recordTitle = scoreRecordTitle(isMyTurn, activePlayerName)

  return (
    <>
      {/*
        레이아웃이 바뀌어도 트리 한 벌만 쓴다. 넓이별로 다른 트리를 반환하면
        React가 위치가 같고 타입이 다른 노드를 갈아끼우면서 주사위 영역을 언마운트하고,
        그때마다 rapier 물리 월드와 WebGL 컨텍스트가 통째로 재생성된다.
      */}
      {/* 뷰포트 높이로 고정하고 페이지 스크롤을 막는다 — 스크롤은 점수시트 내부에서만 일어난다. */}
      <main
        className={cn(
          'h-svh overflow-hidden bg-canvas text-content',
          wide ? 'grid grid-cols-[1fr_32.5rem]' : 'flex flex-col',
        )}
      >
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* 배너는 오버레이로 띄운다 — 플로우에 끼우면 나타날 때마다 3D 트레이 크기를 밀어
              씬이 리사이즈된다. 연결 상태는 일시적이라 헤더를 잠깐 덮는 쪽이 낫다. */}
          <ConnectionBanner
            className="absolute inset-x-0 top-0 z-banner"
            status={connectionStatus}
          />
          {header}
          {turnStrip}

          {/* 모바일 기록 패널이 이 컨테이너 아래에 붙는다 — 주사위 씬은 항상 같은 자리다. */}
          <div className={cn('flex min-h-0 flex-1 flex-col', !wide && 'relative')}>
            {diceScene}
            <footer
              className={cn(
                'flex flex-none items-center px-gutter',
                wide
                  ? // 안내문은 트레이 하단 가운데에 있다 — 푸터에는 버튼만 가운데에 남는다.
                    'justify-center gap-4 border-t border-border py-4'
                  : 'gap-2.5 pt-2 pb-[calc(8.75rem+env(safe-area-inset-bottom))]',
              )}
            >
              {actions}
            </footer>

            {wide ? null : (
              <RecordPanel
                onToggle={setSheetOpen}
                open={sheetOpen}
                quick={quickStrip}
                subtitle={`${openCategories.length}개 남음`}
                title={recordTitle}
              >
                {scoreSheet('h-full')}
              </RecordPanel>
            )}
          </div>
        </div>

        {/* 디자인 Yacht Play 3D — 점수시트는 우측 상시 패널(520px)이다. */}
        {wide ? (
          <section aria-label="점수 시트" className="flex min-h-0 flex-col border-l border-border">
            <div className="flex flex-none items-center justify-between gap-2 px-4 py-3">
              <span className="text-[11px] font-bold tracking-[0.1em] uppercase">점수 시트</span>
              <span className="truncate text-[11px] text-content-faint">{sheetHint}</span>
            </div>
            {scoreSheet('min-h-0 flex-1')}
          </section>
        ) : null}
      </main>

      <ToastHost message={toastMessage} />
      {zeroModal}
      <GameHelpModal onClose={() => setHelpOpen(false)} open={helpOpen} />
    </>
  )
}

function scoreLeaderLabel(players: ReturnType<typeof toMatrixPlayers>) {
  const leader = players.reduce(
    (best, player) =>
      (player.scoreboard?.total ?? 0) > (best?.scoreboard?.total ?? 0) ? player : best,
    players[0],
  )
  return leader ? `${leader.nickname} · ${leader.scoreboard?.total ?? 0}` : '—'
}

function scoreSheetHint(isMyTurn: boolean, rolled: boolean, activePlayerName?: string) {
  if (!isMyTurn) return `${activePlayerName ?? '—'} 차례`
  return rolled ? '행을 탭하면 바로 기록됩니다' : '먼저 주사위를 굴리세요'
}

function scoreRecordTitle(isMyTurn: boolean, activePlayerName?: string) {
  return `기록 — ${isMyTurn ? '나' : (activePlayerName ?? '—')}`
}

function QuickCategoryStrip({
  canPick,
  candidates,
  categories,
  onPick,
  rolled,
}: {
  canPick: boolean
  candidates: CategoryScores
  categories: YachtCategory[]
  onPick: (category: YachtCategory) => void
  rolled: boolean
}) {
  return (
    <ul className="m-0 flex list-none gap-2 overflow-x-auto px-4 py-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {categories.map((category) => {
        const score = rolled ? (candidates[category] ?? 0) : null
        const scoreLabel = score === null ? '' : ` ${score}점 기록`
        return (
          <li className="flex-none" key={category}>
            <button
              aria-label={`${categoryLabel[category]}${scoreLabel}`}
              className="flex h-[4.125rem] min-w-[5.5rem] cursor-pointer flex-col items-start justify-between rounded-control border border-border bg-surface px-2.5 py-2 text-left text-content transition-colors focus-visible:outline-3 focus-visible:outline-focus focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-55"
              disabled={!canPick || !rolled}
              onClick={() => onPick(category)}
              type="button"
            >
              <span className="text-[10px] font-semibold tracking-[0.07em] uppercase">
                {categoryShortLabel[category]}
              </span>
              <span className="font-mono text-[22px] leading-none font-bold tabular-nums">
                {score ?? '—'}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function GamePlayActions({
  activePlayerName,
  canReleaseAll,
  canRoll,
  isMyTurn,
  onReleaseAll,
  onRoll,
  rolling,
  submitted,
  submitting,
  wide,
}: {
  activePlayerName: string | undefined
  canReleaseAll: boolean
  canRoll: boolean
  isMyTurn: boolean
  onReleaseAll: () => void
  onRoll: () => void
  rolling: boolean
  submitted: boolean
  submitting: boolean
  wide: boolean
}) {
  if (submitted) return <WaitingNotice activePlayerName={undefined} submitted />
  if (!isMyTurn) return <WaitingNotice activePlayerName={activePlayerName} submitted={false} />

  return (
    <>
      <Button
        className={cn('min-h-15 rounded-panel text-[17px]', wide ? 'w-[300px]' : 'flex-1')}
        disabled={!canRoll}
        loading={rolling || submitting}
        onClick={onRoll}
        size="lg"
      >
        {rolling ? '굴리는 중' : '굴리기'}
        {wide && !rolling && <span className="ml-2 text-xs font-medium opacity-70">Space</span>}
      </Button>
      {wide && (
        <Button
          className="min-h-15"
          disabled={!canReleaseAll}
          onClick={onReleaseAll}
          variant="ghost"
        >
          모두 해제
        </Button>
      )}
    </>
  )
}

function WaitingNotice({
  activePlayerName,
  submitted,
}: {
  activePlayerName: string | undefined
  submitted: boolean
}) {
  if (submitted) {
    return (
      <p className="m-0 flex min-h-15 flex-1 items-center justify-center gap-2.5 rounded-panel border border-positive/40 bg-positive/10 px-4 text-center text-sm font-semibold text-positive">
        <span
          aria-hidden="true"
          className="grid size-5 flex-none place-items-center rounded-[7px] bg-positive/20 text-[11px] leading-none font-bold"
        >
          ✓
        </span>
        점수가 반영됐습니다. 다음 턴을 기다립니다.
      </p>
    )
  }

  return (
    <p className="m-0 flex min-h-15 flex-1 items-center justify-center gap-2.5 rounded-panel border border-border bg-surface px-4 text-center text-sm font-semibold text-content-muted">
      <span
        aria-hidden="true"
        className="size-2 flex-none rounded-[2px] bg-brand-strong motion-safe:animate-ring-pulse"
      />
      {activePlayerName ? `${activePlayerName}(이)가 굴리는 중` : '턴 동기화 중'}
    </p>
  )
}

function ZeroScoreModal({
  category,
  onCancel,
  onConfirm,
}: {
  category: YachtCategory | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      onClose={onCancel}
      open={category !== null}
      role="alertdialog"
      title={category ? `${categoryLabel[category]}를 0점으로 확정할까요?` : ''}
    >
      <p className="m-0 text-sm text-content-muted">이 족보는 다시 사용할 수 없습니다.</p>
      {/* 디자인 19 — 안전한 선택(취소)이 위, 파괴적 동작은 레드 틴트 아웃라인.
          RoomExitGuard의 확인 다이얼로그와 같은 배치·같은 variant를 쓴다. */}
      <div className="mt-5 grid gap-2.5">
        <Button onClick={onCancel} variant="secondary">
          취소
        </Button>
        <Button onClick={onConfirm} variant="danger">
          0점 확정
        </Button>
      </div>
    </Modal>
  )
}

/** 웹 전용 단축키. 리스너를 매 렌더 다시 붙이지 않도록 최신 핸들러만 ref로 넘긴다. */
function useShortcuts(
  enabled: boolean,
  handlers: {
    dispatch: (action: YachtGameAction) => void
    onRoll: () => void
  },
) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      // 버튼·입력처럼 Space·Enter가 고유 동작인 요소에 포커스가 있으면 단축키를 양보한다.
      // 여기서 preventDefault하면 그 요소의 활성화 자체가 막힌다.
      if (
        event.target instanceof Element &&
        event.target.closest(
          'a[href],button,input,select,textarea,[contenteditable],[role="button"]',
        )
      ) {
        return
      }
      if (event.code === 'Space') {
        event.preventDefault()
        handlersRef.current.onRoll()
        return
      }
      const slot = Number(event.key)
      if (Number.isInteger(slot) && slot >= 1 && slot <= 5) {
        handlersRef.current.dispatch({ type: 'holdToggled', index: (slot - 1) as DiceIndex })
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}

/**
 * 마감 처리는 서버가 한다 — 남은 굴림이 있으면 대신 굴리고, 다 쓰면 남은 족보 중 하나를 기록한 뒤
 * 턴을 넘긴다(RoundTimeoutResolver). 클라이언트가 같은 일을 하면 두 경로가 경합하면서 어느 쪽도
 * 기록되지 않는 창이 생기므로 여기서는 아무것도 하지 않는다.
 */
/**
 * 내 차례가 시작되는 순간 한 번 알린다(QA 7번). 턴이 넘어가면 다시 무장된다.
 * 렌더마다 발화하지 않도록 직전 값과 비교한다 — 상태가 아니라 "전이"가 트리거다.
 */
function useMyTurnAlert({ isMyTurn, onAlert }: { isMyTurn: boolean; onAlert: () => void }) {
  const wasMyTurnRef = useRef(false)
  const onAlertRef = useRef(onAlert)
  onAlertRef.current = onAlert

  useEffect(() => {
    if (isMyTurn && !wasMyTurnRef.current) onAlertRef.current()
    wasMyTurnRef.current = isMyTurn
  }, [isMyTurn])
}

/**
 * 라운드가 바뀌는 순간 한 번 알린다(QA FND-7). 관전자에게도 전환 신호를 주되,
 * 턴마다 띄우면 피로하므로 라운드 시작으로 한정한다.
 */
function useRoundStartNotice({
  onNotice,
  roundNumber,
}: {
  onNotice: () => void
  roundNumber: number
}) {
  const previousRoundRef = useRef<number | null>(null)
  const onNoticeRef = useRef(onNotice)
  onNoticeRef.current = onNotice

  useEffect(() => {
    const previous = previousRoundRef.current
    previousRoundRef.current = roundNumber
    // 첫 렌더(중간 입장·재접속 포함)는 "전환"이 아니다 — 라운드가 실제로 바뀔 때만 알린다.
    if (previous === null || previous === roundNumber) return
    onNoticeRef.current()
  }, [roundNumber])
}

/** 짧은 두 번 진동. 미지원(iOS Safari 등)이면 조용히 넘어간다 — 토스트가 이미 알린다. */
function vibrateForMyTurn() {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate([90, 60, 90])
  } catch {
    // 사용자 제스처 없이 호출하면 던지는 브라우저가 있다. 알림 실패가 게임을 막아선 안 된다.
  }
}
