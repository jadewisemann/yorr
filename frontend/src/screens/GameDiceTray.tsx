import { useState } from 'react'
import { cn } from '@/cn'
import { Button } from '@/components/Button'
import { MotionPermissionPanel } from '@/components/MotionPermissionPanel'
import { PhysicsDiceScene } from '@/components/PhysicsDiceScene'
import { RollCounter } from '@/components/RollCounter'
import { EffectCallout, RollResultCallout } from '@/components/RollResultCallout'
import { Tooltip } from '@/components/Tooltip'
import { TutorialGuide } from '@/components/TutorialGuide'
import { MAX_ROLLS } from '@/domain/yachtGame'
import type { MotionAvailability } from '@/input/motionTypes'
import type { Player } from '@/realtime/wsEvents'
import { hideTutorial, isTutorialHidden } from '@/tutorialPreference'
import type { GamePlayRoll } from './useGamePlayRoll'

interface GameDiceTrayProps {
  activePlayer: Player | undefined
  isMyTurn: boolean
  onTurnCalloutDone: () => void
  roll: GamePlayRoll
  roundNumber: number
  turnCallout: number | null
  wide: boolean
}

export function GameDiceTray({
  activePlayer,
  isMyTurn,
  onTurnCalloutDone,
  roll,
  roundNumber,
  turnCallout,
  wide,
}: GameDiceTrayProps) {
  const [dismissedNotice, setDismissedNotice] = useState<MotionAvailability | null>(null)
  const [tutorialOpen, setTutorialOpen] = useState(() => !isTutorialHidden())
  const {
    allKept,
    canHold,
    canRoll,
    completeRoll,
    confirmThrow,
    currentRollNumber,
    dismissRollHighlight,
    keptCount,
    lastRollInPlay,
    local,
    motion,
    motionPulse,
    onDiceImpact,
    onPhysicsError,
    onPhysicsPhaseChange,
    pendingRoll,
    releaseRequestId,
    remoteShaking,
    roll: handleRoll,
    rollHighlight,
    rollInputMode,
    settledRollCount,
    submitted,
    toggleHeld,
  } = roll

  const keptSum = local.dice
    ? local.dice.reduce((sum, value, index) => sum + (local.held[index] ? value : 0), 0)
    : 0
  const rolled = local.dice !== null
  const permissionNoticeVisible =
    isMotionPermissionNotice(motion.availability) && dismissedNotice !== motion.availability
  const activePlayerName = activePlayer?.nickname
  const trayLabel = diceTrayLabel({ activePlayerName, currentRollNumber, isMyTurn })
  const statusText = diceTrayStatus({
    activePlayerName,
    allKept,
    isMyTurn,
    rolled,
    roundNumber,
    submitted,
  })
  const keptText = keptRailLabel(keptCount, keptSum, allKept)

  return (
    <div
      className={cn(
        'relative min-h-0 flex-1 overflow-hidden rounded-[1.375rem] border border-white/8 shadow-[inset_0_2px_0_rgb(255_255_255_/_6%),inset_0_-26px_46px_rgb(0_0_0_/_62%)] transition-transform [background:var(--ds-physics-tray)] motion-reduce:transform-none',
        wide ? 'mx-gutter my-3' : 'mx-gutter mt-3 mb-1',
        motion.lastPulseDirection === 'left' && '-translate-x-1',
        motion.lastPulseDirection === 'right' && 'translate-x-1',
      )}
    >
      <div className="pointer-events-none absolute top-3 left-4 z-10 text-[10px] font-bold tracking-[0.13em] text-content-faint uppercase">
        {trayLabel}
      </div>
      <div className="pointer-events-none absolute top-2.5 right-3 z-10 flex items-center gap-1.5">
        <RollCounter rollsUsed={settledRollCount} />
        <Tooltip
          align="end"
          className="pointer-events-auto text-content-faint"
          content="턴마다 최대 3번 굴릴 수 있어요. 주사위 눈이 남은 횟수예요."
          label="남은 굴리기 설명"
        />
      </div>
      <div className="pointer-events-none absolute inset-x-4 bottom-2.5 z-10 grid grid-cols-[1fr_auto_1fr] items-end gap-3">
        <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-[0.13em] text-content-faint uppercase">
          킵 레일 · {keptText}
          <Tooltip
            align="start"
            className="pointer-events-auto"
            content="주사위를 탭하면 킵돼서 여기 줄지어요. 킵한 주사위는 다시 굴리지 않고, 한 번 더 탭하면 풀려요."
            label="킵 레일 설명"
            side="top"
          />
        </span>
        {wide ? (
          <p className="m-0 text-center text-sm/none whitespace-nowrap text-content-muted">
            {statusText}
          </p>
        ) : (
          <span />
        )}
        <span />
      </div>
      <PhysicsDiceScene
        dice={local.dice}
        held={local.held}
        lineUpAll={lastRollInPlay}
        motionFollow={rollInputMode === 'motion' || remoteShaking}
        motionPulse={motionPulse}
        onDiceImpact={onDiceImpact}
        onError={onPhysicsError}
        {...(canHold ? { onHeldToggle: toggleHeld } : {})}
        onPhaseChange={onPhysicsPhaseChange}
        onRollComplete={completeRoll}
        releaseRequestId={releaseRequestId}
        request={pendingRoll}
      />
      {canRoll && local.dice === null && !pendingRoll && (
        <button
          aria-label="주사위 굴리기"
          className="absolute inset-0 z-10 grid cursor-pointer place-items-center border-0 bg-transparent focus-visible:outline-3 focus-visible:outline-focus focus-visible:-outline-offset-4"
          onClick={handleRoll}
          type="button"
        >
          <span className="text-[11px] font-bold tracking-[0.1em] text-content-faint uppercase">
            탭해서 굴리기
          </span>
        </button>
      )}
      {rollHighlight && (
        <RollResultCallout
          hand={rollHighlight.hand}
          key={rollHighlight.id}
          onDone={dismissRollHighlight}
        />
      )}
      {turnCallout !== null && (
        <EffectCallout key={turnCallout} onDone={onTurnCalloutDone} text="내 차례!" tier={2} />
      )}
      {pendingRoll && rollInputMode === 'motion' && (
        <Button
          className="absolute top-14 right-3 z-20 shadow-raised"
          disabled={releaseRequestId !== null}
          onClick={confirmThrow}
        >
          지금 던지기
        </Button>
      )}
      {permissionNoticeVisible && (
        <div className="absolute inset-x-3 top-3 z-30">
          <MotionPermissionPanel
            availability={motion.availability}
            onClose={() => setDismissedNotice(motion.availability)}
            onRequestPermission={motion.requestPermission}
          />
        </div>
      )}
      {tutorialOpen && !permissionNoticeVisible && (
        <TutorialGuide
          isMyTurn={isMyTurn && !submitted}
          kept={keptCount > 0}
          onFinish={() => {
            hideTutorial()
            setTutorialOpen(false)
          }}
          onNeverShowAgain={() => {
            hideTutorial()
            setTutorialOpen(false)
          }}
          onSkip={() => setTutorialOpen(false)}
          rolled={rolled}
          submitted={submitted}
        />
      )}
    </div>
  )
}

function diceTrayLabel({
  activePlayerName,
  currentRollNumber,
  isMyTurn,
}: {
  activePlayerName: string | undefined
  currentRollNumber: number
  isMyTurn: boolean
}) {
  if (!activePlayerName) return '턴 동기화 중'
  return isMyTurn
    ? `롤링 존 · 나 · 굴림 ${currentRollNumber}/${MAX_ROLLS}`
    : `롤링 존 · ${activePlayerName}의 턴`
}

function diceTrayStatus({
  activePlayerName,
  allKept,
  isMyTurn,
  rolled,
  roundNumber,
  submitted,
}: {
  activePlayerName: string | undefined
  allKept: boolean
  isMyTurn: boolean
  rolled: boolean
  roundNumber: number
  submitted: boolean
}) {
  if (submitted) return '점수가 반영됐습니다 · 다음 턴 대기'
  if (!isMyTurn) return `${activePlayerName ?? '—'}님이 굴리는 중입니다`
  if (allKept) return '모두 킵했습니다 · 해제하거나 족보를 기록하세요'
  if (rolled) return '홀드하고 다시 굴리거나, 족보를 탭해 기록하세요'
  return `라운드 ${roundNumber} — 굴려서 시작하세요`
}

function keptRailLabel(keptCount: number, keptSum: number, allKept: boolean) {
  if (keptCount === 0) return '비어 있음'
  const releaseHint = allKept ? ' · 해제해야 굴릴 수 있어요' : ''
  return `${keptCount}/5 · 합 ${keptSum}${releaseHint}`
}

function isMotionPermissionNotice(availability: MotionAvailability) {
  return (
    availability === 'permissionRequired' ||
    availability === 'requesting' ||
    availability === 'denied' ||
    availability === 'error' ||
    availability === 'insecure'
  )
}
