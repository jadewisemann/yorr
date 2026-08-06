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
  /**
   * 연습 모드가 자기 안내를 직접 띄우는 중인지. 그렇다면 첫 진입 코치마크를 띄우지 않는다 —
   * 배우는 화면에 안내가 두 겹으로 뜨면 어느 쪽을 따라야 하는지 알 수 없다.
   */
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
  /*
   * 첫 진입에는 "설명은 툴팁에 있다"만 알리는 코치마크를 띄운다(S15P11A406-143).
   * 한 턴을 따라다니던 마스코트 가이드는 실전에서 걷어내고 /tutorial 연습 모드로 옮겼다 —
   * 실전은 이미 아는 사람이 대부분이고, 배우는 건 실패해도 되는 자리에서 해야 한다.
   */
  const [coachOpen, setCoachOpen] = useState(() => !guided && !isTutorialHidden())
  /*
   * 모션 안내는 켤 수 있는 상태가 되는 즉시 뜬다(S15P11A406-182 QA). 닫으면 흔들기 칩으로
   * 다시 연다 — 권한 안내는 3초 뒤 스스로 닫히므로 오래 막지 않는다.
   *
   * <b>단, 코치마크와 같은 순간에 뜨지는 않는다.</b> 두 안내가 겹치면 z-30인 이 패널이
   * 코치마크(z-6)의 「알겠어요」를 덮어 <b>첫 진입 사용자가 코치마크를 닫을 수 없다</b>
   * (182의 자동 열림과 143의 코치마크가 만나 생긴 자리다. 320px에서 실측·재현).
   * 코치마크를 닫는 순간 이어서 뜬다 — 둘 다 첫 진입 안내지만 한 번에 하나씩 읽힌다.
   */
  const [motionPanelOpen, setMotionPanelOpen] = useState(() => !coachOpen)
  const {
    allKept,
    canHold,
    canPlay,
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
    rollsLeft,
    settledRollCount,
    submitted,
    toggleHeld,
  } = roll

  const rolled = local.dice !== null
  /*
   * 한때 칩을 눌러야만 안내가 열렸다(S15P11A406-143). 실제로는 아무도 누르지 않아 흔들기가
   * 있다는 것 자체를 모른 채 끝났다 — QA에서 "바로 뜨게"로 돌렸다(S15P11A406-182).
   * 막지 않는 근거는 패널 쪽에 있다: 권한 안내는 3초 뒤 스스로 닫히고, 닫힌 뒤에는 칩이
   * 다시 나타나 언제든 열 수 있다.
   *
   * canPlay=false(파티 모드 대시보드)면 안내도 칩도 내지 않는다. 그 기기로는 굴릴 수 없어
   * 켤 이유가 없다 — 센서도 시작되지 않아 availability는 'unknown'에 머문다.
   */
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
        'relative min-h-0 flex-1 overflow-hidden rounded-panel border border-white/8 shadow-[inset_0_2px_0_rgb(255_255_255_/_6%),inset_0_-26px_46px_rgb(0_0_0_/_62%)] transition-transform [background:var(--ds-physics-tray)] motion-reduce:transform-none',
        wide ? 'mx-gutter my-3' : 'mx-gutter mt-3 mb-1',
        motion.lastPulseDirection === 'left' && '-translate-x-1',
        motion.lastPulseDirection === 'right' && 'translate-x-1',
      )}
      data-tutorial="tray"
    >
      {/* 400px 미만에서는 감춘다. 이 라벨과 오른쪽 상단 띠(흔들기 · 남은 굴리기 · ⓘ)는 서로를
          밀 수 없는 절대 배치 형제라, 둘의 폭 합이 트레이를 넘으면 글자가 칩 위에 겹쳐 그려진다
          — 겹친 라벨은 안내가 아니라 오작동으로 읽힌다(A-2 캐러셀 힌트와 같은 판단).
          한때 tiny(360px)로 막아 뒀는데 실측하면 375px에서 12px 겹쳐 "굴림 1/3"의 횟수가 칩
          밑에 깔렸다. 갈림길은 398px이라 tray(400px)로 올린다 — 근거는 그 토큰 주석에 있다.
          잃는 정보가 없다: 굴림 횟수는 오른쪽 칩이, 누구 턴인지는 헤더가 이미 말한다. */}
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
        motionPulse={motionPulse}
        onDiceImpact={onDiceImpact}
        onError={onPhysicsError}
        {...(canHold ? { onHeldToggle: toggleHeld } : {})}
        onPhaseChange={onPhysicsPhaseChange}
        onRollComplete={completeRoll}
        releaseRequestId={releaseRequestId}
        request={pendingRoll}
      />
      {/* 첫 굴림 전에는 트레이 전체가 탭 타깃이다.
          z는 상·하단 밴드(z-10)보다 낮게 둔다 — inset-0라 같은 층에 두면 나중에 그려지는
          이쪽이 이겨서 밴드의 ⓘ를 눌러도 툴팁 대신 굴림이 나간다. 밴드는 자기 자신은
          pointer-events-none이라 ⓘ 밖을 누르면 그대로 여기로 떨어진다. */}
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
      {motionOfferable && motionPanelOpen && (
        <div className="absolute inset-x-3 top-3 z-30">
          <MotionPermissionPanel
            availability={motion.availability}
            onClose={() => setMotionPanelOpen(false)}
            onRequestPermission={motion.requestPermission}
          />
        </div>
      )}
      {/* 첫 진입 안내 — 툴팁 두 개만 밝히고 나머지를 덮는다. 이 위에서 ⓘ를 바로 눌러 볼 수 있다.
          canPlay=false(파티 모드 대시보드)에는 내지 않는다 — 조작할 수 없는 화면에 조작 안내다. */}
      {canPlay && coachOpen && (
        <TooltipCoachmark
          onDone={() => {
            hideTutorial()
            setCoachOpen(false)
            // 코치마크를 닫으면 미뤄 둔 모션 안내를 이어서 띄운다(위 motionPanelOpen 주석).
            setMotionPanelOpen(true)
          }}
        />
      )}
    </div>
  )
}
