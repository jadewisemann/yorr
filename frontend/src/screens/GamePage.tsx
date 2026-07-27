import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Button } from '@/components/Button'
import { MotionPermissionPanel } from '@/components/MotionPermissionPanel'
import { PhysicsDiceScene } from '@/components/PhysicsDiceScene'
import {
  createYachtGame,
  getPendingRoll,
  type YachtGameState,
  yachtGameReducer,
} from '@/domain/yachtGame'
import { createRollFeedback } from '@/feedback/createRollFeedback'
import type { MotionGestureEvent } from '@/input/motionTypes'
import type { RollInputMode } from '@/input/RollIntent'
import { useMotionRollInput } from '@/input/useMotionRollInput'
import type {
  PhysicsDiceIndex,
  PhysicsDicePhase,
  PhysicsDiceSet,
} from '@/rendering/physics-dice/types'
import { useAppStore } from '@/store'

const TAP_RELEASE_DELAY_MS = 600

export function GamePage({ roomId }: { roomId: string }) {
  const navigate = useNavigate()
  const roomSession = useAppStore((state) => state.roomSession)
  const roomSnapshot = useAppStore((state) => state.roomSnapshot)
  const matchingRoom = roomSession?.roomId === roomId

  useEffect(() => {
    if (!roomSession || !roomSnapshot || !matchingRoom) {
      void navigate({ to: '/', replace: true })
      return
    }
    if (roomSnapshot.phase === 'waiting') {
      void navigate({
        to: '/rooms/$roomId/lobby',
        params: { roomId: roomSession.roomId },
        replace: true,
      })
    }
  }, [matchingRoom, navigate, roomSession, roomSnapshot])

  if (!roomSession || !roomSnapshot || !matchingRoom) return null
  if (roomSnapshot.phase === 'finished') {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center text-content">
        <section className="grid gap-2">
          <p className="font-bold text-brand-strong">ROUND {roomSnapshot.game?.roundNumber ?? 1}</p>
          <h1 className="text-display font-bold">게임이 끝났어요</h1>
          <p className="text-content-muted">결과 화면을 준비하고 있어요.</p>
        </section>
      </main>
    )
  }

  const roundNumber = roomSnapshot.game?.roundNumber ?? 1
  return <MotionYachtGame key={roundNumber} roundNumber={roundNumber} />
}

function MotionYachtGame({ roundNumber }: { roundNumber: number }) {
  const [game, dispatch] = useReducer(yachtGameReducer, undefined, () =>
    createYachtGame(Date.now(), roundNumber),
  )
  const [releaseRequestId, setReleaseRequestId] = useState<string | null>(null)
  const [rendererPhase, setRendererPhase] = useState<PhysicsDicePhase>('idle')
  const [rollInputMode, setRollInputMode] = useState<RollInputMode | null>(null)
  const gameRef = useRef(game)
  const inputModeRef = useRef(rollInputMode)
  const requestSequenceRef = useRef(0)
  const feedbackRef = useRef<ReturnType<typeof createRollFeedback> | null>(null)
  gameRef.current = game
  inputModeRef.current = rollInputMode
  if (!feedbackRef.current) feedbackRef.current = createRollFeedback()

  const beginRoll = useCallback((inputMode: RollInputMode) => {
    const current = gameRef.current
    if (!canStartRoll(current)) return
    requestSequenceRef.current += 1
    const requestId = `roll-${current.roundNumber}-${requestSequenceRef.current}`
    setReleaseRequestId(null)
    setRollInputMode(inputMode)
    dispatch({ type: 'rollRequested', requestId })
  }, [])

  const handleGestureEvent = useCallback(
    (event: MotionGestureEvent) => {
      switch (event.type) {
        case 'shakePulse':
          feedbackRef.current?.shakePulse(event.direction, event.strength)
          return
        case 'shakeStarted':
          feedbackRef.current?.armed()
          beginRoll('motion')
          return
        case 'throwDetected': {
          const request = getPendingRoll(gameRef.current)
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
    [beginRoll],
  )

  const motion = useMotionRollInput(handleGestureEvent)
  const pendingRoll = getPendingRoll(game)

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

  const confirmThrow = () => {
    if (!pendingRoll || releaseRequestId === pendingRoll.requestId) return
    feedbackRef.current?.thrown()
    setReleaseRequestId(pendingRoll.requestId)
  }

  const completeRoll = (requestId: string, dice: PhysicsDiceSet) => {
    dispatch({ type: 'rollCompleted', requestId, dice })
    setReleaseRequestId(null)
    setRollInputMode(null)
    motion.resetGesture('roll-complete')
  }

  const toggleHeld = (index: PhysicsDiceIndex) => {
    dispatch({ type: 'holdToggled', index })
  }

  const statusMessage = getGestureMessage({
    availability: motion.availability,
    gestureState: motion.gestureState,
    pendingMotionRoll: Boolean(pendingRoll && rollInputMode === 'motion'),
  })
  const rollDisabled = !canStartRoll(game)
  const canToggleHeld = game.phase === 'choosing' && game.rollCount < 3
  const pulseOffset =
    motion.lastPulseDirection === 'left'
      ? '-translate-x-1'
      : motion.lastPulseDirection === 'right'
        ? 'translate-x-1'
        : ''

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-content content-start gap-4 p-4 text-content sm:p-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="m-0 text-sm font-bold text-brand-strong">ROUND {game.roundNumber}</p>
          <h1 className="m-0 text-2xl font-bold">휴대폰으로 주사위 던지기</h1>
        </div>
        <span className="rounded-control bg-surface-raised px-3 py-2 text-sm font-bold">
          {game.rollCount}/3회
        </span>
      </header>

      <section
        className={`relative h-[56dvh] min-h-[390px] max-h-[620px] overflow-hidden rounded-panel border border-border shadow-raised transition-transform motion-reduce:transform-none motion-reduce:transition-none [@media(max-height:500px)]:min-h-[240px] ${pulseOffset} [background:var(--ds-physics-tray)]`}
        aria-label="주사위 게임 영역"
      >
        <PhysicsDiceScene
          dice={game.dice}
          held={game.held}
          releaseRequestId={releaseRequestId}
          request={pendingRoll}
          onError={() => feedbackRef.current?.error()}
          {...(canToggleHeld ? { onHeldToggle: toggleHeld } : {})}
          onPhaseChange={setRendererPhase}
          onRollComplete={completeRoll}
        />
        {pendingRoll && rollInputMode === 'motion' && (
          <Button
            className="absolute top-3 right-3 z-20 shadow-raised"
            onClick={confirmThrow}
            disabled={releaseRequestId !== null}
          >
            지금 던지기
          </Button>
        )}
      </section>

      <section
        className="grid gap-3 rounded-panel border border-border bg-surface p-4"
        aria-label="모션 입력 상태"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <p className="m-0 font-bold" role="status">
              {statusMessage}
            </p>
            <p className="m-0 text-sm text-content-muted">
              휴대폰을 손에서 놓지 마세요. 센서가 안 되면 버튼으로 계속할 수 있어요.
            </p>
          </div>
          <span className="shrink-0 rounded-control border border-border px-2 py-1 font-mono text-xs text-content-muted">
            {rendererPhase}
          </span>
        </div>

        {isPermissionNoticeState(motion.availability) && (
          <MotionPermissionPanel
            availability={motion.availability}
            onRequestPermission={motion.requestPermission}
          />
        )}

        <div className="grid">
          <Button
            onClick={() => beginRoll('tap')}
            disabled={rollDisabled}
            variant={motion.inputMode === 'tap' ? 'primary' : 'secondary'}
          >
            {pendingRoll ? '굴리는 중' : '버튼으로 굴리기'}
          </Button>
        </div>
      </section>
    </main>
  )
}

function canStartRoll(game: YachtGameState) {
  return (game.phase === 'ready' || game.phase === 'choosing') && game.rollCount < 3
}

function getGestureMessage({
  availability,
  gestureState,
  pendingMotionRoll,
}: {
  availability: ReturnType<typeof useMotionRollInput>['availability']
  gestureState: ReturnType<typeof useMotionRollInput>['gestureState']
  pendingMotionRoll: boolean
}) {
  if (availability === 'permissionRequired') {
    return '센서로 흔들려면 먼저 센서 사용을 시작해 주세요'
  }
  if (availability === 'requesting') return '센서 권한을 확인하고 있어요'
  if (availability === 'denied') return '센서 권한이 거부되어 버튼 모드로 전환했어요'
  if (availability === 'insecure') return 'HTTPS가 아니어서 센서를 사용할 수 없어요'
  if (availability === 'unsupported') return '이 브라우저는 센서를 지원하지 않아요'
  if (availability === 'silent') return '센서값이 없어 버튼 모드로 전환했어요'
  if (availability === 'error') return '센서를 시작하지 못해 버튼 모드로 전환했어요'
  if (gestureState === 'calibrating') return '센서를 보정하고 있어요. 잠시 휴대폰을 고정해 주세요'
  if (pendingMotionRoll || gestureState === 'shaking') {
    return '좋아요! 휴대폰을 꽉 잡고 앞으로 휙 움직이세요'
  }
  if (gestureState === 'armed') return '앞으로 휙 움직이거나 지금 던지기를 누르세요'
  if (gestureState === 'shakeCandidate') return '조금 더 좌우로 흔들어 주세요'
  if (gestureState === 'cooldown' || gestureState === 'thrown') return '주사위를 던졌어요'
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
