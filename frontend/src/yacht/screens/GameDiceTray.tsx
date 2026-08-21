import { useState } from 'react'
import type { Player } from '@/realtime/wsEvents'
import { cn } from '@/shared/cn'
import { Button } from '@/shared/components/Button'
import {
  TooltipCoachmark,
  TrayBottomBand,
  TrayTopBand,
} from '@/yacht/components/GameDiceTray/TrayBands'
import { MotionPermissionPanel } from '@/yacht/components/MotionPermissionPanel'
import { PhysicsDiceScene } from '@/yacht/components/PhysicsDiceScene'
import { EffectCallout, RollResultCallout } from '@/yacht/components/RollResultCallout'
import {
  diceTrayLabel,
  diceTrayStatus,
  keepRailState,
  keptRailLabel,
} from '@/yacht/domain/diceTrayLabels'
import { canOfferMotion } from '@/yacht/input/motionTypes'
import type { GamePlayRoll } from '@/yacht/model/useGamePlayRoll'
import { hideTutorial, isTutorialHidden } from '@/yacht/tutorialPreference'

interface GameDiceTrayProps {
  activePlayer: Player | undefined
  guided: boolean
  isMyTurn: boolean
  onTurnCalloutDone: () => void
  roll: GamePlayRoll
  roundNumber: number
  turnCallout: number | null
  wide: boolean
}

export function GameDiceTray({
  activePlayer,
  guided,
  isMyTurn,
  onTurnCalloutDone,
  roll,
  roundNumber,
  turnCallout,
  wide,
}: GameDiceTrayProps) {
  const [coachOpen, setCoachOpen] = useState(() => !guided && !isTutorialHidden())
  const [motionPanelOpen, setMotionPanelOpen] = useState(() => !coachOpen)
  const {
    allKept,
    canHold,
    canPlay,
    canRoll,
    completeRoll,
    confirmThrow,
    currentRollNumber,
    keptCount,
    lastRollInPlay,
    local,
    motion,
    feedback,
    pendingRoll,
    releaseRequestId,
    remoteShaking,
    roll: handleRoll,
    rollInputMode,
    rollsLeft,
    settledRollCount,
    submitted,
    toggleHeld,
  } = roll

  const rolled = local.dice !== null
  const motionOfferable = canPlay && canOfferMotion(motion.availability)
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
  const keptText = keptRailLabel(keepRailState(local, keptCount, lastRollInPlay), rollsLeft)

  return (
    <div
      className={cn(
        'relative min-h-0 flex-1 overflow-hidden rounded-panel border border-border shadow-[var(--ds-physics-tray-shadow)] transition-transform [background:var(--ds-physics-tray)] motion-reduce:transform-none',
        wide ? 'mx-gutter my-3' : 'mx-gutter mt-3 mb-1',
        motion.lastPulseDirection === 'left' && '-translate-x-1',
        motion.lastPulseDirection === 'right' && 'translate-x-1',
      )}
      data-tutorial="tray"
    >
      <div className="pointer-events-none absolute top-3 left-4 z-10 text-2xs font-bold tracking-[0.13em] text-content-faint tabular-nums uppercase max-tray:hidden">
        {trayLabel}
      </div>
      <TrayTopBand
        coachOpen={coachOpen}
        onOpenMotionPanel={() => setMotionPanelOpen(true)}
        settledRollCount={settledRollCount}
        showMotionChip={motionOfferable && !motionPanelOpen}
      />
      <TrayBottomBand
        coachOpen={coachOpen}
        keptText={keptText}
        statusText={statusText}
        wide={wide}
      />
      <PhysicsDiceScene
        dice={local.dice}
        held={local.held}
        keepAll={lastRollInPlay}
        motionFollow={rollInputMode === 'motion' || remoteShaking}
        motionPulse={feedback.motionPulse}
        onDiceImpact={feedback.diceImpact}
        onError={feedback.physicsError}
        {...(canHold ? { onHeldToggle: toggleHeld } : {})}
        onPhaseChange={feedback.phaseChanged}
        onRollComplete={completeRoll}
        releaseRequestId={releaseRequestId}
        request={pendingRoll}
      />
      {canRoll && local.dice === null && !pendingRoll && (
        <button
          aria-label="주사위 굴리기"
          className="absolute inset-0 z-[4] grid cursor-pointer place-items-center border-0 bg-transparent focus-ring focus-visible:-outline-offset-4"
          onClick={handleRoll}
          type="button"
        >
          <span className="text-2xs font-bold tracking-[0.1em] text-content-faint uppercase">
            탭해서 굴리기
          </span>
        </button>
      )}
      {feedback.rollHighlight && (
        <RollResultCallout
          hand={feedback.rollHighlight.hand}
          key={feedback.rollHighlight.id}
          onDone={feedback.dismissHighlight}
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
      {motionOfferable && motionPanelOpen && (
        <div className="absolute inset-x-3 top-3 z-30">
          <MotionPermissionPanel
            availability={motion.availability}
            onClose={() => setMotionPanelOpen(false)}
            onRequestPermission={motion.requestPermission}
          />
        </div>
      )}
      {canPlay && coachOpen && (
        <TooltipCoachmark
          onDone={() => {
            hideTutorial()
            setCoachOpen(false)
            setMotionPanelOpen(true)
          }}
        />
      )}
    </div>
  )
}
