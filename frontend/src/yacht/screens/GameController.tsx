import { useState } from 'react'
import type { Player } from '@/realtime/wsEvents'
import { Button } from '@/shared/components/Button'
import { MotionPermissionPanel } from '@/yacht/components/MotionPermissionPanel'
import { PhysicsDiceFallback } from '@/yacht/components/PhysicsDiceFallback'
import { RollCounter } from '@/yacht/components/RollCounter'
import { RollResultCallout } from '@/yacht/components/RollResultCallout'
import { canOfferMotion } from '@/yacht/input/motionTypes'
import type { GamePlayRoll } from '@/yacht/model/useGamePlayRoll'

/**
 * 파티 모드 폰 화면 — <b>게임판이 아니라 컨트롤러</b>다(S15P11A406-182).
 *
 * 큰 화면이 이미 3D 주사위·점수표·턴 순서를 다 보여주고 있다. 폰에서 같은 것을 한 번 더
 * 그리면 둘 중 어디를 봐야 하는지 알 수 없고, 손에 든 기기가 화면 취급을 받는다. 그래서
 * 여기서는 <b>WebGL 트레이를 아예 마운트하지 않고</b>(배터리·발열도 그만큼 준다) 손으로
 * 만지는 것만 남긴다: 킵 5칸 · 남은 굴리기 · 굴리기 · 점수 쓰기.
 *
 * 주사위 줄은 {@link PhysicsDiceFallback}을 그대로 쓴다. 3D 실패 대체 화면으로 만들어 둔
 * 것이지만 하는 일이 정확히 같다 — 눈을 보여주고, 탭으로 킵을 토글하고, 굴림 요청을
 * 완료시킨다(씬이 없으면 굴림이 끝나지 않으므로 이 완료 신호가 필수다).
 */
interface GameControllerPadProps {
  activePlayer: Player | undefined
  isMyTurn: boolean
  roll: GamePlayRoll
}

export function GameControllerPad({ activePlayer, isMyTurn, roll }: GameControllerPadProps) {
  // 규칙은 GameDiceTray와 같다 — 켤 수 있으면 바로 뜨고, 닫으면 다시 열 수 있다.
  // 한쪽만 바꾸지 말 것. 컨트롤러에서는 흔들기가 주 입력이라 더 그렇다.
  const [motionPanelOpen, setMotionPanelOpen] = useState(true)
  const {
    canHold,
    canPlay,
    completeRoll,
    confirmThrow,
    dismissRollHighlight,
    local,
    motion,
    pendingRoll,
    releaseRequestId,
    rollHighlight,
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

      {/* 눈은 큰 화면에서 굴러가고, 여기서는 남길 것을 고르는 곳이다. */}
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
            className="cursor-pointer rounded-full border border-border bg-surface/80 px-2.5 py-1 text-2xs font-bold tracking-[0.06em] text-content-muted uppercase focus-ring"
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

      {/* "내 차례!" 대형 콜아웃은 두지 않는다 — 컨트롤러는 손에 들려 있고 진동이 이미 알린다.
          좁은 패드에서 화면을 덮는 연출은 조작을 잠깐 가릴 뿐이다. 족보 연출은 남긴다:
          점수가 되는 결과라 눌러야 할 것이 달라진다. */}
      {rollHighlight && (
        <RollResultCallout
          hand={rollHighlight.hand}
          key={rollHighlight.id}
          onDone={dismissRollHighlight}
        />
      )}
    </section>
  )
}

/*
 * 하단 바는 만들지 않는다. 굴리기·대기 안내는 일반 모드의 `GamePlayActions`를 그대로 쓰고,
 * 기록은 기존 기록 패널 손잡이로 연다 — 컨트롤러라고 버튼 모양까지 새로 만들면 같은 동작이
 * 두 벌이 되고, 손이 익힌 자리도 화면마다 달라진다. 바뀌는 것은 위쪽뿐이다.
 */
