import { useState } from 'react'
import type { Player } from '@/realtime/wsEvents'
import { cn } from '@/shared/cn'
import { Button } from '@/shared/components/Button'
import { Tooltip } from '@/shared/components/Tooltip'
import { MotionPermissionPanel } from '@/yacht/components/MotionPermissionPanel'
import { PhysicsDiceScene } from '@/yacht/components/PhysicsDiceScene'
import { RollCounter } from '@/yacht/components/RollCounter'
import { EffectCallout, RollResultCallout } from '@/yacht/components/RollResultCallout'
import { MAX_ROLLS } from '@/yacht/domain/yachtGame'
import { canOfferMotion } from '@/yacht/input/motionTypes'
import { hideTutorial, isTutorialHidden } from '@/yacht/tutorialPreference'
import type { GamePlayRoll } from './useGamePlayRoll'

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
        'relative min-h-0 flex-1 overflow-hidden rounded-[1.375rem] border border-white/8 shadow-[inset_0_2px_0_rgb(255_255_255_/_6%),inset_0_-26px_46px_rgb(0_0_0_/_62%)] transition-transform [background:var(--ds-physics-tray)] motion-reduce:transform-none',
        wide ? 'mx-gutter my-3' : 'mx-gutter mt-3 mb-1',
        motion.lastPulseDirection === 'left' && '-translate-x-1',
        motion.lastPulseDirection === 'right' && 'translate-x-1',
      )}
      data-tutorial="tray"
    >
      {/* 320px에서는 감춘다. 이 라벨과 오른쪽 상단 띠(흔들기 · 남은 굴리기 · ⓘ)는 서로를 밀 수
          없는 절대 배치 형제라, 둘의 폭 합(약 300px)이 트레이를 넘으면 글자가 칩 위에 겹쳐 그려진다
          — 겹친 라벨은 안내가 아니라 오작동으로 읽힌다(A-2 캐러셀 힌트와 같은 판단).
          잃는 정보가 없다: 굴림 횟수는 오른쪽 칩이, 누구 턴인지는 헤더가 이미 말한다. */}
      <div className="pointer-events-none absolute top-3 left-4 z-10 text-[10px] font-bold tracking-[0.13em] text-content-faint tabular-nums uppercase max-tiny:hidden">
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

/**
 * 트레이 위쪽 띠 — 남은 굴리기와 흔들기 입구. 밴드 자신은 클릭을 통과시키고, 실제로 눌러야
 * 하는 칩·툴팁 트리거만 pointer-events를 되살린다(트레이 탭 = 굴리기이므로).
 */
function TrayTopBand({
  coachOpen,
  onOpenMotionPanel,
  settledRollCount,
  showMotionChip,
}: {
  coachOpen: boolean
  onOpenMotionPanel: () => void
  settledRollCount: number
  showMotionChip: boolean
}) {
  return (
    <div className="pointer-events-none absolute top-2.5 right-3 z-10 flex items-center gap-1.5">
      {/* 흔들기 안내로 들어가는 조용한 입구. 알럿과 달리 아무것도 막지 않고 기다린다. */}
      {showMotionChip && (
        <button
          className="pointer-events-auto flex cursor-pointer items-center gap-1 rounded-full border border-border bg-surface/80 px-2 py-1 text-[10px] font-bold tracking-[0.06em] text-content-muted uppercase transition-colors hover:text-content focus-ring focus-visible:outline-offset-2"
          data-tutorial="motion"
          onClick={onOpenMotionPanel}
          type="button"
        >
          <span aria-hidden="true">📱</span>
          흔들기
        </button>
      )}
      <RollCounter rollsUsed={settledRollCount} />
      <Tooltip
        align="end"
        className="pointer-events-auto text-content-faint"
        content="턴마다 최대 3번 굴릴 수 있어요. 주사위 눈이 남은 횟수예요."
        label="남은 굴리기 설명"
        spotlight={coachOpen}
      />
    </div>
  )
}

/** 트레이 아래쪽 띠 — 킵 레일 라벨(좌)과 안내문(가운데)을 같은 grid에 둔다. */
function TrayBottomBand({
  coachOpen,
  keptText,
  statusText,
  wide,
}: {
  coachOpen: boolean
  keptText: string
  statusText: string
  wide: boolean
}) {
  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-2.5 z-10 grid grid-cols-[1fr_auto_1fr] items-end gap-3">
      {/* 주사위를 탭할 때마다 숫자가 바뀐다 — tabular-nums가 없으면 라벨 폭이 흔들려
          옆에 붙은 툴팁 트리거까지 함께 밀린다. */}
      <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-[0.13em] text-content-faint tabular-nums uppercase">
        킵 레일 · {keptText}
        <Tooltip
          align="start"
          className="pointer-events-auto"
          content="주사위를 탭하면 킵돼서 여기 줄지어요. 킵한 주사위는 다시 굴리지 않고, 한 번 더 탭하면 풀려요."
          label="킵 레일 설명"
          side="top"
          spotlight={coachOpen}
        />
      </span>
      {/* 안내문은 와이드에서만 — 모바일은 기록 패널이 안내를 겸한다.
          빈 자리를 <span/>으로 메우지 않는다. 트랙 셋(1fr auto 1fr)과 gap은 grid가
          이미 잡고 있어, 항목이 없어도 가운데 칸은 그대로 선다. */}
      {wide && (
        <p className="m-0 text-center text-sm/none whitespace-nowrap text-content-muted">
          {statusText}
        </p>
      )}
    </div>
  )
}

/**
 * 첫 진입 안내(S15P11A406-143). 주사위 판만 덮고 툴팁이 얹힌 상·하단 밴드는 남겨,
 * 링이 켜진 ⓘ 두 개가 어두운 배경 위에서 저절로 눈에 띄게 한다.
 *
 * z는 토큰(sticky 10 …) 아래의 5·6을 직접 쓴다 — 트레이 안에서 "밴드(z-10)보다 아래"만
 * 뜻하는 국소 값이라, 앱 전역 레이어 스케일에 새 단을 만들 일이 아니다.
 */
function TooltipCoachmark({ onDone }: { onDone: () => void }) {
  return (
    <>
      <button
        aria-label="안내 닫기"
        className="absolute inset-0 z-[5] cursor-pointer border-0 bg-black/65"
        onClick={onDone}
        type="button"
      />
      <div className="absolute inset-x-6 top-1/2 z-[6] grid -translate-y-1/2 gap-2.5 rounded-card border border-border-strong bg-surface-raised/95 p-3.5 shadow-raised">
        <p aria-live="polite" className="m-0 text-[13.5px] leading-relaxed text-content">
          지금 빛나는 동그라미 두 개를 눌러 보세요. 굴리기 횟수와 킵 레일 설명이 그 자리에서 나와요.
        </p>
        <p className="m-0 text-[12.5px] leading-relaxed text-content-muted">
          요트다이스가 처음이라면 헤더의 도움말에서 <strong>튜토리얼 모드</strong>를 켜 보세요.
        </p>
        <Button onClick={onDone} size="sm" variant="secondary">
          알겠어요
        </Button>
      </div>
    </>
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

interface KeepRailState {
  /** 레일에 올라간 주사위 수. 라벨의 n/5가 이 값이다. */
  count: number
  /** 그 주사위들의 눈 합. */
  sum: number
  /** 다섯 개가 다 올라가 있는지. 굴림이 남았다면 해제해야 굴릴 수 있다는 뜻이다. */
  full: boolean
}

/**
 * 킵 레일에 지금 무엇이 올라가 있는가. 마지막 굴림 뒤에는 더 굴릴 것이 없으므로 킵하지 않은
 * 주사위까지 전부 확정이고, 화면에서도 다섯 개가 레일에 올라앉는다(PhysicsDiceScene keepAll) —
 * 라벨과 합이 그 그림과 같은 것을 세야 한다.
 */
function keepRailState(
  local: GamePlayRoll['local'],
  keptCount: number,
  lastRollInPlay: boolean,
): KeepRailState {
  if (!local.dice) return { count: keptCount, sum: 0, full: false }
  const onRail = (index: number) => lastRollInPlay || local.held[index] === true
  const count = lastRollInPlay ? 5 : keptCount
  return {
    count,
    sum: local.dice.reduce((sum, value, index) => sum + (onRail(index) ? value : 0), 0),
    full: count === 5,
  }
}

/**
 * "해제해야 굴릴 수 있어요"는 굴림이 남았을 때만 맞는 말이다 — 마지막 굴림 뒤엔 다섯 개가
 * 다 올라가 있어도 해제할 이유가 없다.
 */
function keptRailLabel(rail: KeepRailState, rollsLeft: number) {
  if (rail.count === 0) return '비어 있음'
  const releaseHint = rail.full && rollsLeft > 0 ? ' · 해제해야 굴릴 수 있어요' : ''
  return `${rail.count}/5 · 합 ${rail.sum}${releaseHint}`
}
