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
  const panels = useTrayPanels(guided)
  const { canPlay, motion, settledRollCount } = roll
  const motionOfferable = canPlay && canOfferMotion(motion.availability)
  const { keptText, statusText, trayLabel } = trayTexts({
    activePlayerName: activePlayer?.nickname,
    isMyTurn,
    roll,
    roundNumber,
  })

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
        coachOpen={panels.coachOpen}
        onOpenMotionPanel={panels.openMotionPanel}
        settledRollCount={settledRollCount}
        showMotionChip={motionOfferable && !panels.motionPanelOpen}
      />
      <TrayBottomBand
        coachOpen={panels.coachOpen}
        keptText={keptText}
        statusText={statusText}
        wide={wide}
      />
      <TrayDiceScene roll={roll} />
      <TapToRollButton roll={roll} />
      <TrayCallouts
        feedback={roll.feedback}
        onTurnCalloutDone={onTurnCalloutDone}
        turnCallout={turnCallout}
      />
      <ThrowNowButton roll={roll} />
      <TrayOnboarding canPlay={canPlay} motion={motion} panels={panels} />
    </div>
  )
}

interface TrayTextInput {
  activePlayerName: string | undefined
  isMyTurn: boolean
  roll: GamePlayRoll
  roundNumber: number
}

/** 트레이 왼쪽 위 라벨, 아래 띠의 상태 문구와 남긴 주사위 문구. */
function trayTexts({ activePlayerName, isMyTurn, roll, roundNumber }: TrayTextInput) {
  const { local } = roll
  return {
    keptText: keptRailLabel(
      keepRailState(local, roll.keptCount, roll.lastRollInPlay),
      roll.rollsLeft,
    ),
    statusText: diceTrayStatus({
      activePlayerName,
      allKept: roll.allKept,
      isMyTurn,
      rolled: local.dice !== null,
      roundNumber,
      submitted: roll.submitted,
    }),
    trayLabel: diceTrayLabel({
      activePlayerName,
      currentRollNumber: roll.currentRollNumber,
      isMyTurn,
    }),
  }
}

type TrayPanels = ReturnType<typeof useTrayPanels>

/**
 * 트레이 위 안내 두 겹의 열림 상태. 첫 판 코치마크가 떠 있는 동안은 흔들기 권한 안내를
 * 미뤘다가, 코치마크를 닫는 순간 이어서 연다 — 둘이 같은 자리에 겹쳐 뜨지 않게 한다.
 */
function useTrayPanels(guided: boolean) {
  const [coachOpen, setCoachOpen] = useState(() => !guided && !isTutorialHidden())
  const [motionPanelOpen, setMotionPanelOpen] = useState(() => !coachOpen)
  return {
    closeMotionPanel: () => setMotionPanelOpen(false),
    coachOpen,
    finishCoach: () => {
      hideTutorial()
      setCoachOpen(false)
      setMotionPanelOpen(true)
    },
    motionPanelOpen,
    openMotionPanel: () => setMotionPanelOpen(true),
  }
}

function TrayDiceScene({ roll }: { roll: GamePlayRoll }) {
  const { canHold, completeRoll, feedback, lastRollInPlay, local, toggleHeld } = roll
  return (
    <PhysicsDiceScene
      dice={local.dice}
      held={local.held}
      keepAll={lastRollInPlay}
      motionFollow={roll.rollInputMode === 'motion' || roll.remoteShaking}
      motionPulse={feedback.motionPulse}
      onDiceImpact={feedback.diceImpact}
      onError={feedback.physicsError}
      {...(canHold ? { onHeldToggle: toggleHeld } : {})}
      onPhaseChange={feedback.phaseChanged}
      onRollComplete={completeRoll}
      releaseRequestId={roll.releaseRequestId}
      request={roll.pendingRoll}
    />
  )
}

interface TrayCalloutsProps {
  feedback: GamePlayRoll['feedback']
  onTurnCalloutDone: () => void
  turnCallout: number | null
}

/** 족보 연출과 "내 차례!" 연출 — 둘 다 key가 바뀔 때마다 처음부터 다시 뜬다. */
function TrayCallouts({ feedback, onTurnCalloutDone, turnCallout }: TrayCalloutsProps) {
  return (
    <>
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
    </>
  )
}

interface TrayOnboardingProps {
  canPlay: boolean
  motion: GamePlayRoll['motion']
  panels: TrayPanels
}

/** 첫 판 코치마크와 흔들기 권한 안내 — 어느 쪽이 먼저 뜨는지는 `useTrayPanels`가 정한다. */
function TrayOnboarding({ canPlay, motion, panels }: TrayOnboardingProps) {
  const motionOfferable = canPlay && canOfferMotion(motion.availability)
  return (
    <>
      {motionOfferable && panels.motionPanelOpen && (
        <div className="absolute inset-x-3 top-3 z-30">
          <MotionPermissionPanel
            availability={motion.availability}
            onClose={panels.closeMotionPanel}
            onRequestPermission={motion.requestPermission}
          />
        </div>
      )}
      {canPlay && panels.coachOpen && <TooltipCoachmark onDone={panels.finishCoach} />}
    </>
  )
}

/** 아직 한 번도 굴리지 않은 트레이는 전체가 굴리기 버튼이다. */
function TapToRollButton({ roll }: { roll: GamePlayRoll }) {
  if (!roll.canRoll || roll.local.dice !== null || roll.pendingRoll) return null
  return (
    <button
      aria-label="주사위 굴리기"
      className="absolute inset-0 z-[4] grid cursor-pointer place-items-center border-0 bg-transparent focus-ring focus-visible:-outline-offset-4"
      onClick={roll.roll}
      type="button"
    >
      <span className="text-2xs font-bold tracking-[0.1em] text-content-faint uppercase">
        탭해서 굴리기
      </span>
    </button>
  )
}

/** 흔들기로 굴리는 중이면 흔들기를 끝내지 않고도 바로 던질 수 있다. */
function ThrowNowButton({ roll }: { roll: GamePlayRoll }) {
  if (!roll.pendingRoll || roll.rollInputMode !== 'motion') return null
  return (
    <Button
      className="absolute top-14 right-3 z-20 shadow-raised"
      disabled={roll.releaseRequestId !== null}
      onClick={roll.confirmThrow}
    >
      지금 던지기
    </Button>
  )
}
