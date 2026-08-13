import { useState } from 'react'
import type { Player } from '@/realtime/wsEvents'
import { Button } from '@/shared/components/Button'
import { MotionPermissionPanel } from '@/yacht/components/MotionPermissionPanel'
import { PhysicsDiceFallback } from '@/yacht/components/PhysicsDiceFallback'
import { RollCounter } from '@/yacht/components/RollCounter'
import { RollResultCallout } from '@/yacht/components/RollResultCallout'
import { canOfferMotion } from '@/yacht/input/motionTypes'
import type { GamePlayRoll } from '@/yacht/model/useGamePlayRoll'

interface GameControllerPadProps {
  activePlayer: Player | undefined
  isMyTurn: boolean
  roll: GamePlayRoll
}

export function GameControllerPad({ activePlayer, isMyTurn, roll }: GameControllerPadProps) {
  const [motionPanelOpen, setMotionPanelOpen] = useState(true)
  const {
    canHold,
    canPlay,
    completeRoll,
    confirmThrow,
    local,
    motion,
    pendingRoll,
    releaseRequestId,
    feedback,
    rollInputMode,
    settledRollCount,
    toggleHeld,
  } = roll
  const motionOfferable = canPlay && canOfferMotion(motion.availability)

  return (
    <section
      aria-label="컨트롤러"
      className="relative flex min-h-0 flex-1 flex-col justify-center gap-3 px-gutter"
    >
      {motionOfferable && motionPanelOpen && (
        <MotionPermissionPanel
          availability={motion.availability}
          onClose={() => setMotionPanelOpen(false)}
          onRequestPermission={motion.requestPermission}
        />
      )}

      <p className="m-0 text-center text-base font-bold" role="status">
        {isMyTurn ? '내 차례' : `${activePlayer?.nickname ?? '—'} 차례`}
      </p>

      <div className="relative min-h-[7.5rem]">
        <PhysicsDiceFallback
          dice={local.dice}
          held={local.held}
          label="남길 주사위"
          {...(canHold ? { onHeldToggle: toggleHeld } : {})}
          onRollComplete={completeRoll}
          releaseRequestId={releaseRequestId}
          request={pendingRoll}
        />
      </div>

      <div className="flex items-center justify-center gap-3">
        <RollCounter rollsUsed={settledRollCount} />
        {motionOfferable && !motionPanelOpen && (
          <button
            className="cursor-pointer rounded-full border border-border bg-surface/80 px-2.5 py-1 text-2xs font-bold tracking-[0.06em] text-content-muted uppercase focus-ring pressable"
            onClick={() => setMotionPanelOpen(true)}
            type="button"
          >
            흔들기
          </button>
        )}
        {rollInputMode === 'motion' && !pendingRoll && (
          <span className="text-2xs text-content-faint">흔들어서 굴려도 돼요</span>
        )}
      </div>

      {pendingRoll && rollInputMode === 'motion' && (
        <Button
          className="mx-auto"
          disabled={releaseRequestId !== null}
          onClick={confirmThrow}
          size="sm"
        >
          지금 던지기
        </Button>
      )}

      {feedback.rollHighlight && (
        <RollResultCallout
          hand={feedback.rollHighlight.hand}
          key={feedback.rollHighlight.id}
          onDone={feedback.dismissHighlight}
        />
      )}
    </section>
  )
}
