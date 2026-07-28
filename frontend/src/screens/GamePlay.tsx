import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/cn'
import { BottomSheet } from '@/components/BottomSheet'
import { Button } from '@/components/Button'
import { CategorySheet } from '@/components/CategorySheet'
import { ConnectionBanner } from '@/components/ConnectionBanner'
import { KeepTray } from '@/components/KeepTray'
import { Modal } from '@/components/Modal'
import { MotionPermissionPanel } from '@/components/MotionPermissionPanel'
import { PhysicsDiceScene } from '@/components/PhysicsDiceScene'
import {
  type PlayerProgress,
  type PlayerProgressEntry,
  PlayerProgressStrip,
} from '@/components/PlayerProgressStrip'
import { RollCounter } from '@/components/RollCounter'
import { RoundTimer } from '@/components/RoundTimer'
import { ScoreMatrix } from '@/components/ScoreMatrix'
import { ScorePanel } from '@/components/ScorePanel'
import { ToastHost, useToast } from '@/components/ToastHost'
import type { DiceIndex, DiceSet } from '@/domain/dice'
import {
  type CategoryScores,
  calculateScoreCandidates,
  YACHT_CATEGORIES,
  type YachtCategory,
} from '@/domain/scoring'
import {
  createYachtGame,
  getPendingRoll,
  type YachtGameAction,
  yachtGameReducer,
} from '@/domain/yachtGame'
import { createRollFeedback } from '@/feedback/createRollFeedback'
import type { MotionAvailability, MotionGestureEvent } from '@/input/motionTypes'
import type { RollInputMode } from '@/input/RollIntent'
import { useMotionRollInput } from '@/input/useMotionRollInput'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import type { Player, PlayerId, RoomSnapshot, ScoreBoard } from '@/realtime/wsEvents'
import { buildClientMessage } from '@/realtime/wsEvents'
import type { PhysicsDiceMotionPulse } from '@/rendering/physics-dice/types'
import { type ActiveRoomSession, useAppStore } from '@/store'
import { useCountdown } from '@/useCountdown'
import { useMediaQuery } from '@/useMediaQuery'
import { categoryLabel, categoryShortLabel, isRecorded } from '@/yachtCategoryView'

/** 이 폭부터 점수표를 시트 대신 좌측 상시 패널로 승격한다(와이어프레임 1c). */
const WIDE_LAYOUT = '(min-width: 1024px)'
const TOTAL_ROUNDS = 12
const MAX_ROLLS = 3
const TAP_RELEASE_DELAY_MS = 600

interface GamePlayProps {
  roomId: string
  session: ActiveRoomSession
  snapshot: RoomSnapshot
}

export function GamePlay({ roomId, session, snapshot }: GamePlayProps) {
  const wide = useMediaQuery(WIDE_LAYOUT)
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const realtimeClient = useRealtimeClient()
  const { message: toastMessage, showToast } = useToast()

  const [tab, setTab] = useState<'dice' | 'scores'>('dice')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [zeroConfirm, setZeroConfirm] = useState<YachtCategory | null>(null)
  const [viewedPlayerId, setViewedPlayerId] = useState<PlayerId>(session.you)
  const [releaseRequestId, setReleaseRequestId] = useState<string | null>(null)
  const [rollInputMode, setRollInputMode] = useState<RollInputMode | null>(null)
  const [motionPulse, setMotionPulse] = useState<PhysicsDiceMotionPulse | null>(null)
  const motionPulseSequenceRef = useRef(0)
  const [submitting, setSubmitting] = useState(false)
  const pendingSubmissionRef = useRef<{
    category: YachtCategory
    msgId: string
  } | null>(null)
  // 닫은 안내가 "어느 상태의 안내였는지"를 담는다. boolean으로 두면 상태가 바뀌어도 계속 닫혀
  // 새 안내를 놓친다 — 값이 달라지는 순간 자동으로 다시 뜨게 하려는 의도다.
  const [dismissedNotice, setDismissedNotice] = useState<MotionAvailability | null>(null)

  const game = snapshot.game
  const roundNumber = game?.roundNumber ?? 1
  const activePlayerId = game?.activePlayerId
  const isMyTurn = activePlayerId === session.you
  const activePlayer = snapshot.players.find((player) => player.playerId === activePlayerId)
  const remainingMs = useCountdown(game?.roundDeadline ?? null)
  const myBoard = game?.scores[session.you]
  const viewedBoard = game?.scores[viewedPlayerId]
  const recorded = viewedBoard?.categories ?? {}

  const [local, setLocal] = useState(() => createYachtGame(Date.now() >>> 0, roundNumber))
  // 서버가 다음 라운드로 넘기면 로컬 굴림 상태를 새로 시작한다.
  if (local.roundNumber !== roundNumber) setLocal(createYachtGame(local.seed, roundNumber))

  const dispatch = useCallback((action: YachtGameAction) => {
    setLocal((state) => yachtGameReducer(state, action))
  }, [])

  const usedCategories = YACHT_CATEGORIES.filter((category) =>
    isRecorded(myBoard?.categories[category]),
  )
  const candidates: CategoryScores = local.dice
    ? calculateScoreCandidates(local.dice, usedCategories)
    : {}
  const recommended = topCandidates(candidates)

  // 재연결 중에는 조작을 잠근다. 서버 상태와 어긋난 굴림·확정이 가장 위험하다.
  const locked = connectionStatus === 'reconnecting' || connectionStatus === 'closed' || !isMyTurn
  const submitted = local.phase === 'roundComplete'
  const rollsLeft = MAX_ROLLS - local.rollCount
  const canRoll =
    !locked &&
    !submitted &&
    rollsLeft > 0 &&
    (local.phase === 'ready' || local.phase === 'choosing')
  const canConfirm = !locked && local.phase === 'choosing' && local.selectedCategory !== null
  const rolling = local.phase === 'rolling'
  // CTA는 "굴리기 / 확정하기" 두 상태로만 고정한다. 굴림 중에는 라벨만 바꾸고 잠근다(1a 최대 리스크).
  const primaryLabel = rolling ? '굴리는 중' : canRoll ? '굴리기' : '확정하기'

  const players = toProgressEntries(snapshot.players, game?.scores, roundNumber, session.you)

  const diceRef = useRef(local.dice)
  diceRef.current = local.dice

  const submitCategory = useCallback(
    (category: YachtCategory) => {
      const dice = diceRef.current
      if (!dice) return
      const msgId = `round-${roundNumber}-${Date.now()}`
      dispatch({ type: 'categorySelected', category })
      dispatch({ type: 'submissionStarted' })
      pendingSubmissionRef.current = { category, msgId }
      setSubmitting(true)
      try {
        realtimeClient.send(
          buildClientMessage('round.submit', { category, dice, roundNumber }, { roomId, msgId }),
        )
      } catch {
        pendingSubmissionRef.current = null
        dispatch({ type: 'submissionFailed' })
        setSubmitting(false)
        showToast('점수를 기록하지 못했어요. 다시 시도해 주세요.')
      }
    },
    [dispatch, realtimeClient, roomId, roundNumber, showToast],
  )

  useEffect(
    () =>
      realtimeClient.onMessage((message) => {
        const pending = pendingSubmissionRef.current
        if (!pending) return

        if (
          message.type === 'score.update' &&
          message.msgId === pending.msgId &&
          message.payload.playerId === session.you
        ) {
          pendingSubmissionRef.current = null
          dispatch({ type: 'submissionSucceeded' })
          setSubmitting(false)
          setSheetOpen(false)
          return
        }

        if (message.type === 'error' && message.payload.refMsgId === pending.msgId) {
          pendingSubmissionRef.current = null
          dispatch({ type: 'submissionFailed' })
          setSubmitting(false)
          showToast(message.payload.message)
        }
      }),
    [dispatch, realtimeClient, session.you, showToast],
  )

  const rollSequenceRef = useRef(0)
  const inputModeRef = useRef(rollInputMode)
  const feedbackRef = useRef<ReturnType<typeof createRollFeedback> | null>(null)
  inputModeRef.current = rollInputMode
  if (!feedbackRef.current) feedbackRef.current = createRollFeedback()

  const beginRoll = useCallback(
    (inputMode: RollInputMode) => {
      if (!canRoll) return
      rollSequenceRef.current += 1
      setReleaseRequestId(null)
      setRollInputMode(inputMode)
      dispatch({
        type: 'rollRequested',
        requestId: `r${roundNumber}-${rollSequenceRef.current}`,
      })
    },
    [canRoll, dispatch, roundNumber],
  )

  const handleGestureEvent = useCallback(
    (event: MotionGestureEvent) => {
      switch (event.type) {
        case 'shakePulse':
          feedbackRef.current?.shakePulse(event.direction, event.strength)
          motionPulseSequenceRef.current += 1
          setMotionPulse({
            id: motionPulseSequenceRef.current,
            direction: event.direction,
            strength: event.strength,
          })
          return
        case 'shakeStarted':
          feedbackRef.current?.armed()
          beginRoll('motion')
          return
        case 'throwDetected': {
          const request = getPendingRoll(local)
          if (!request || inputModeRef.current !== 'motion') return
          feedbackRef.current?.thrown()
          setReleaseRequestId(request.requestId)
          return
        }
        case 'shakeArmed':
        case 'gestureCancelled':
          return
      }
    },
    [beginRoll, local],
  )

  const motion = useMotionRollInput(handleGestureEvent)
  const pendingRoll = getPendingRoll(local)

  useEffect(() => {
    if (!pendingRoll || rollInputMode !== 'tap') return
    const timeout = setTimeout(
      () => setReleaseRequestId(pendingRoll.requestId),
      TAP_RELEASE_DELAY_MS,
    )
    return () => clearTimeout(timeout)
  }, [pendingRoll, rollInputMode])

  useEffect(
    () => () => {
      feedbackRef.current?.dispose()
    },
    [],
  )

  const handleRoll = () => {
    if (!canRoll) return
    beginRoll('tap')
  }

  const confirmThrow = () => {
    if (!pendingRoll || releaseRequestId === pendingRoll.requestId) return
    feedbackRef.current?.thrown()
    setReleaseRequestId(pendingRoll.requestId)
  }

  const completeRoll = (requestId: string, dice: DiceSet) => {
    const rollCount = (local.rollCount + 1) as 1 | 2 | 3
    dispatch({ type: 'rollCompleted', requestId, dice })
    setReleaseRequestId(null)
    setRollInputMode(null)
    motion.resetGesture('roll-complete')
    try {
      realtimeClient.send(
        buildClientMessage(
          'dice.roll',
          { dice, rollCount, roundNumber },
          { roomId, msgId: `roll-${roundNumber}-${rollCount}-${Date.now()}` },
        ),
      )
    } catch {
      showToast('타이머를 갱신하지 못했어요. 연결 상태를 확인해 주세요.')
    }
  }

  const handleConfirm = () => {
    const category = local.selectedCategory
    if (!category || !canConfirm) return
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

  useTimeoutAutoRecord({
    candidates,
    // 'choosing'이 아니면 reducer가 기록 전이를 거부한다. 서버에만 기록되는 어긋남을 막는다.
    enabled: isMyTurn && !locked && !submitted && local.phase === 'choosing' && local.dice !== null,
    expired: game?.roundDeadline !== undefined && remainingMs <= 0,
    onRecord: (category, score) => {
      showToast(`시간이 지나 ${categoryLabel[category]} ${score}점이 기록됐습니다.`)
      submitCategory(category)
    },
    roundNumber,
  })

  useShortcuts(wide && isMyTurn, { onConfirm: handleConfirm, onRoll: handleRoll, dispatch })

  const diceScene = (
    <div
      className={cn(
        'relative min-h-0 flex-1 transition-transform motion-reduce:transform-none',
        motion.lastPulseDirection === 'left' && '-translate-x-1',
        motion.lastPulseDirection === 'right' && 'translate-x-1',
      )}
    >
      <PhysicsDiceScene
        dice={local.dice}
        held={local.held}
        motionFollow={rollInputMode === 'motion'}
        motionPulse={motionPulse}
        releaseRequestId={releaseRequestId}
        onError={() => feedbackRef.current?.error()}
        onHeldToggle={(index) => dispatch({ type: 'holdToggled', index })}
        onRollComplete={completeRoll}
        request={pendingRoll}
      />
      {pendingRoll && rollInputMode === 'motion' && (
        <Button
          className="absolute top-3 right-3 z-20 shadow-raised"
          disabled={releaseRequestId !== null}
          onClick={confirmThrow}
        >
          지금 던지기
        </Button>
      )}
      {isPermissionNoticeState(motion.availability) && dismissedNotice !== motion.availability && (
        <div className="absolute inset-x-3 top-3 z-30">
          <MotionPermissionPanel
            availability={motion.availability}
            onClose={() => setDismissedNotice(motion.availability)}
            onRequestPermission={motion.requestPermission}
          />
        </div>
      )}
    </div>
  )

  const header = (
    <header className="flex-none px-gutter pt-3">
      {/* 화면 최상위 heading. 시각적으로는 RoundTimer가 같은 정보를 그린다. */}
      <h1 className="sr-only">
        요르 게임 진행 중 · {roundNumber} / {TOTAL_ROUNDS} 라운드
      </h1>
      <RoundTimer remainingMs={remainingMs} roundNumber={roundNumber} totalRounds={TOTAL_ROUNDS} />
      <PlayerProgressStrip className="mt-2.5" players={players} />
    </header>
  )

  // 내 차례가 끝나면 CTA 자리를 진행 표시로 바꾼다. 빈 화면을 만들지 않는다(1d).
  const waitingNotice = (
    <p className="m-0 flex min-h-15 flex-1 items-center justify-center rounded-panel border border-dashed border-border px-4 text-center text-sm font-semibold text-content-muted">
      {submitted
        ? '점수가 반영됐습니다 · 다음 턴을 기다리는 중'
        : activePlayer
          ? `${activePlayer.nickname}님의 턴입니다`
          : '턴 정보를 동기화하는 중'}
    </p>
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

  // 넓은 화면에는 탭이 없다 — 점수표가 좌측 상시 패널로 항상 떠 있다.
  const showDice = wide || tab === 'dice'

  const keyboardHint = (
    <p className="m-0 px-gutter text-center text-xs text-content-faint">
      {motion.inputMode === 'motion'
        ? getGestureMessage(motion, Boolean(pendingRoll && rollInputMode === 'motion'))
        : '버튼으로 굴리고 Space·Enter·1~5 키도 씁니다'}
    </p>
  )

  const recommendations = (
    <section className="flex-none px-gutter">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="m-0 text-[11px] font-semibold text-content-muted">추천 족보</h2>
        <button
          className="-mr-1 min-h-tap cursor-pointer border-0 bg-transparent px-1 text-[11.5px] font-semibold text-content underline focus-visible:outline-3 focus-visible:outline-focus"
          onClick={() => setSheetOpen(true)}
          type="button"
        >
          전체 {YACHT_CATEGORIES.length}개 ▸
        </button>
      </div>
      <ul className="grid list-none grid-cols-3 gap-2 p-0">
        {recommended.length === 0 ? (
          <li className="col-span-3 rounded-card border border-dashed border-border py-4 text-center text-[11.5px] text-content-faint">
            주사위를 굴리면 추천 족보가 나타납니다
          </li>
        ) : (
          recommended.map(([category, score], index) => (
            <li key={category}>
              <button
                className={cn(
                  'flex min-h-[3.625rem] w-full cursor-pointer flex-col items-center justify-center gap-px rounded-card bg-surface transition-colors focus-visible:outline-3 focus-visible:outline-focus focus-visible:outline-offset-2 disabled:cursor-not-allowed',
                  local.selectedCategory === category
                    ? 'border-2 border-brand'
                    : 'border border-border',
                )}
                disabled={locked || submitted}
                key={category}
                onClick={() => {
                  dispatch({ type: 'categorySelected', category })
                  setSheetOpen(true)
                }}
                type="button"
              >
                <span className="text-[11px] font-semibold text-content">
                  {categoryShortLabel[category]}
                </span>
                <span className="font-mono text-[18px] font-bold text-content tabular-nums">
                  {score}
                </span>
                <span className="text-[9px] font-semibold text-content-faint">
                  {index === 0 ? '최고 점수' : '사용 가능'}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </section>
  )

  const actions =
    submitted || !isMyTurn ? (
      waitingNotice
    ) : wide ? (
      <>
        <Button
          className="min-h-15 w-[300px] rounded-panel text-[17px]"
          disabled={!canRoll}
          loading={rolling}
          onClick={handleRoll}
          size="lg"
        >
          {rolling ? '굴리는 중' : '굴리기'}
          {!rolling && <span className="ml-2 text-xs font-medium opacity-70">Space</span>}
        </Button>
        <Button
          className="min-h-15 w-[220px] rounded-panel text-[15px]"
          disabled={!canConfirm}
          loading={submitting}
          onClick={handleConfirm}
          size="lg"
          variant="secondary"
        >
          확정하기 <span className="ml-2 text-xs font-medium">Enter</span>
        </Button>
      </>
    ) : (
      <Button
        className="min-h-15 flex-1 rounded-panel text-[17px]"
        disabled={!(canRoll || canConfirm)}
        loading={submitting || rolling}
        onClick={canRoll ? handleRoll : handleConfirm}
        size="lg"
      >
        {primaryLabel}
      </Button>
    )

  return (
    <>
      {/*
        레이아웃과 탭이 바뀌어도 트리 한 벌만 쓴다. 넓이별로 다른 트리를 반환하면
        React가 위치가 같고 타입이 다른 노드를 갈아끼우면서 주사위 영역을 언마운트하고,
        그때마다 rapier 물리 월드와 WebGL 컨텍스트가 통째로 재생성된다.
      */}
      <main
        className={cn(
          'h-svh bg-canvas text-content',
          wide ? 'grid grid-cols-[360px_1fr]' : 'flex flex-col',
        )}
      >
        {wide ? (
          <ScorePanel
            candidates={candidates}
            disabled={!isMyTurn}
            onSelect={(category) => dispatch({ type: 'categorySelected', category })}
            onViewPlayer={setViewedPlayerId}
            players={snapshot.players}
            recorded={recorded}
            selectedCategory={local.selectedCategory}
            total={viewedBoard?.total ?? 0}
            upperSubtotal={viewedBoard?.upperSubtotal ?? 0}
            viewedPlayerId={viewedPlayerId}
            you={session.you}
          />
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col">
          <ConnectionBanner status={connectionStatus} />
          {header}

          {/* 점수표 탭에서도 감추기만 한다 — 언마운트하면 물리 월드를 다시 만든다. */}
          <div className={cn('flex min-h-0 flex-1 flex-col', !showDice && 'hidden')}>
            <KeepTray
              className={cn('mx-gutter flex-none', wide ? 'mt-4' : 'mt-3')}
              dice={local.dice}
              held={local.held}
              locked={locked || local.rollCount >= MAX_ROLLS}
              onRelease={(index) => dispatch({ type: 'holdToggled', index })}
            />
            {diceScene}
            {wide ? keyboardHint : recommendations}
            <footer
              className={cn(
                'flex flex-none items-center px-gutter',
                wide ? 'gap-4 py-5' : 'gap-3 pt-3',
              )}
            >
              <RollCounter rollsUsed={local.rollCount} />
              {actions}
            </footer>
          </div>

          {!wide && tab === 'scores' ? (
            <ScoreMatrix
              className="min-h-0 flex-1"
              players={toMatrixPlayers(snapshot.players, game?.scores, session.you)}
            />
          ) : null}

          {wide ? null : (
            <nav
              aria-label="게임 화면 전환"
              className="mt-3 flex flex-none border-t border-border pb-[env(safe-area-inset-bottom)]"
            >
              {(['dice', 'scores'] as const).map((value) => (
                <button
                  aria-current={tab === value}
                  className={cn(
                    'min-h-14 flex-1 cursor-pointer border-0 bg-transparent text-[13px] focus-visible:outline-3 focus-visible:outline-focus focus-visible:outline-offset-[-3px]',
                    tab === value
                      ? 'border-b-[3px] border-brand font-bold text-content'
                      : 'font-semibold text-content-muted',
                  )}
                  key={value}
                  onClick={() => setTab(value)}
                  type="button"
                >
                  {value === 'dice' ? '주사위' : '점수표'}
                </button>
              ))}
            </nav>
          )}
        </div>
      </main>

      {wide ? null : (
        <BottomSheet onClose={() => setSheetOpen(false)} open={sheetOpen} title="족보 선택">
          <CategorySheet
            candidates={candidates}
            disabled={!isMyTurn}
            onConfirm={handleConfirm}
            onSelect={(category) => dispatch({ type: 'categorySelected', category })}
            recorded={myBoard?.categories ?? {}}
            selectedCategory={local.selectedCategory}
            submitting={submitting}
            total={myBoard?.total ?? 0}
          />
        </BottomSheet>
      )}

      <ToastHost message={toastMessage} />
      {zeroModal}
    </>
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
      title={category ? `${categoryLabel[category]}를 0점으로 확정할까요?` : ''}
    >
      <p className="m-0 text-sm text-content-muted">이 족보는 다시 사용할 수 없습니다.</p>
      <div className="mt-5 flex gap-2">
        <Button className="flex-1" onClick={onCancel} variant="secondary">
          취소
        </Button>
        <Button className="flex-1" onClick={onConfirm}>
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
    onConfirm: () => void
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
      if (event.key === 'Enter') {
        event.preventDefault()
        handlersRef.current.onConfirm()
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
 * 시간이 다 되면 남은 족보 중 최고 점수를 자동 기록한다. 조작을 막는 모달은 띄우지 않는다.
 * ⚠️ 이 규칙(최고점 자동 vs 최저 손실)은 와이어프레임 1d에서 제품 결정 대기 항목이다.
 */
function useTimeoutAutoRecord({
  candidates,
  enabled,
  expired,
  onRecord,
  roundNumber,
}: {
  candidates: CategoryScores
  enabled: boolean
  expired: boolean
  onRecord: (category: YachtCategory, score: number) => void
  roundNumber: number
}) {
  const latestRef = useRef({ candidates, onRecord })
  const recordedRoundRef = useRef<number | null>(null)
  latestRef.current = { candidates, onRecord }

  useEffect(() => {
    if (!expired || !enabled) return
    if (recordedRoundRef.current === roundNumber) return
    const best = topCandidates(latestRef.current.candidates)[0]
    if (!best) return
    recordedRoundRef.current = roundNumber
    latestRef.current.onRecord(best[0], best[1])
  }, [enabled, expired, roundNumber])
}

function topCandidates(candidates: CategoryScores): Array<[YachtCategory, number]> {
  return (Object.entries(candidates) as Array<[YachtCategory, number]>)
    .sort(([, left], [, right]) => right - left)
    .slice(0, 3)
}

function getGestureMessage(
  motion: ReturnType<typeof useMotionRollInput>,
  pendingMotionRoll: boolean,
) {
  if (motion.availability === 'permissionRequired') {
    return '센서로 흔들려면 먼저 센서 사용을 시작해 주세요'
  }
  if (motion.availability === 'requesting') return '센서 권한을 확인하고 있어요'
  if (motion.availability === 'denied') return '센서 권한이 거부되어 버튼 모드로 전환했어요'
  if (motion.availability === 'insecure') return 'HTTPS가 아니어서 센서를 사용할 수 없어요'
  if (motion.availability === 'unsupported') return '이 브라우저는 센서를 지원하지 않아요'
  if (motion.availability === 'silent') return '센서값이 없어 버튼 모드로 전환했어요'
  if (motion.availability === 'error') return '센서를 시작하지 못해 버튼 모드로 전환했어요'
  if (motion.gestureState === 'calibrating') {
    return '센서를 보정하고 있어요. 잠시 휴대폰을 고정해 주세요'
  }
  if (pendingMotionRoll || motion.gestureState === 'shaking') {
    return '좋아요! 휴대폰을 꽉 잡고 앞으로 휙 움직이세요'
  }
  if (motion.gestureState === 'armed') return '앞으로 휙 움직이거나 지금 던지기를 누르세요'
  if (motion.gestureState === 'shakeCandidate') return '조금 더 좌우로 흔들어 주세요'
  if (motion.gestureState === 'cooldown' || motion.gestureState === 'thrown') {
    return '주사위를 던졌어요'
  }
  return '휴대폰을 꽉 잡고 좌우로 흔들어 주세요'
}

function isPermissionNoticeState(
  availability: ReturnType<typeof useMotionRollInput>['availability'],
): availability is 'permissionRequired' | 'requesting' | 'denied' | 'error' | 'insecure' {
  return (
    availability === 'permissionRequired' ||
    availability === 'requesting' ||
    availability === 'denied' ||
    availability === 'error' ||
    availability === 'insecure'
  )
}

function toProgressEntries(
  players: Player[],
  scores: Record<PlayerId, ScoreBoard> | undefined,
  roundNumber: number,
  you: PlayerId,
): PlayerProgressEntry[] {
  return players
    .filter((player) => player.playerId !== you)
    .map((player) => ({
      nickname: player.nickname,
      playerId: player.playerId,
      progress: progressOf(player, scores?.[player.playerId], roundNumber),
    }))
}

/**
 * 서버 계약에 플레이어별 "굴리는 중/완료" 필드가 없다.
 * 점수판에 채워진 칸 수가 끝낸 라운드 수와 같으므로 그걸로 유추한다.
 */
function progressOf(
  player: Player,
  board: ScoreBoard | undefined,
  roundNumber: number,
): PlayerProgress {
  if (player.status !== 'online') return 'reconnecting'
  const filled = YACHT_CATEGORIES.filter((category) => isRecorded(board?.categories[category]))
  return filled.length >= roundNumber ? 'done' : 'rolling'
}

function toMatrixPlayers(
  players: Player[],
  scores: Record<PlayerId, ScoreBoard> | undefined,
  you: PlayerId,
) {
  const ordered = [...players].sort((left, right) => {
    if (left.playerId === you) return -1
    if (right.playerId === you) return 1
    return 0
  })
  return ordered.map((player) => ({
    nickname: player.playerId === you ? '나' : player.nickname,
    playerId: player.playerId,
    scoreboard: scores?.[player.playerId],
  }))
}
