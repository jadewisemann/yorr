import { useEffect, useRef, useState } from 'react'
import { loadPhysicsDiceWorld } from '@/rendering/physics-dice/loadWorld'
import type {
  PhysicsDiceIndex,
  PhysicsDiceMotionPulse,
  PhysicsDicePhase,
  PhysicsDiceQuality,
  PhysicsDiceRollRequest,
  PhysicsDiceSet,
  PhysicsDiceWorldCallbacks,
  PhysicsHeldDice,
} from '@/rendering/physics-dice/types'
import { PhysicsDiceFallback } from './PhysicsDiceFallback'

type PhysicsDiceSceneProps = {
  dice: PhysicsDiceSet | null
  held: PhysicsHeldDice
  /**
   * true면 킵된 주사위도 킵 레일이 아니라 결과 줄에 함께 눕는다. 마지막 굴림부터 켜서
   * 다섯 개를 한 줄로 보여준다 — 그 뒤에는 킵을 바꿀 수 없다(S15P11A406-94).
   */
  lineUpAll?: boolean
  /** true면 사발 흔들림이 canned 애니메이션 대신 motionPulse 에너지를 따라간다. */
  motionFollow?: boolean
  motionPulse?: PhysicsDiceMotionPulse | null
  releaseRequestId: string | null
  onDiceImpact?: (index: PhysicsDiceIndex, strength: number) => void
  onError?: (error: Error) => void
  onHeldToggle?: (index: PhysicsDiceIndex) => void
  onPhaseChange?: (phase: PhysicsDicePhase) => void
  onRollComplete: (requestId: string, dice: PhysicsDiceSet) => void
  quality?: PhysicsDiceQuality
  request: PhysicsDiceRollRequest | null
}

type PhysicsDiceWorldInstance = InstanceType<
  typeof import('@/rendering/physics-dice/World').PhysicsDiceWorld
>

type LatestSceneState = {
  dice: PhysicsDiceSet | null
  held: PhysicsHeldDice
  lineUpAll: boolean
  motionFollow: boolean | undefined
  quality: PhysicsDiceQuality
  releaseRequestId: string | null
  request: PhysicsDiceRollRequest | null
}

function applyInitialSceneState(
  world: PhysicsDiceWorldInstance,
  latest: LatestSceneState,
  startedRequests: Set<string>,
  releasedRequests: Set<string>,
) {
  world.applyQuality(latest.quality)
  if (latest.motionFollow !== undefined) world.setMotionFollow(latest.motionFollow)
  // 배치 규칙을 먼저 세운 뒤에 주사위를 놓는다 — 순서가 뒤집히면 한 번 잘못 눕는다.
  world.setLineUpAll(latest.lineUpAll)
  world.syncCommittedDice(latest.dice, latest.held)

  const request = latest.request
  if (!request) return
  if (!startedRequests.has(request.requestId)) {
    startedRequests.add(request.requestId)
    world.startRoll(request)
  }
  if (latest.releaseRequestId !== request.requestId || releasedRequests.has(request.requestId))
    return
  releasedRequests.add(request.requestId)
  world.pour()
}

export function PhysicsDiceScene({
  dice,
  held,
  lineUpAll = false,
  motionFollow,
  motionPulse,
  releaseRequestId,
  onDiceImpact,
  onError,
  onHeldToggle,
  onPhaseChange,
  onRollComplete,
  quality = 'balanced',
  request,
}: PhysicsDiceSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<PhysicsDiceWorldInstance | null>(null)
  const callbacksRef = useRef({
    onDiceImpact,
    onError,
    onHeldToggle,
    onPhaseChange,
    onRollComplete,
  })
  const latestRef = useRef({
    dice,
    held,
    lineUpAll,
    motionFollow,
    quality,
    releaseRequestId,
    request,
  })
  const startedRequestsRef = useRef(new Set<string>())
  const releasedRequestsRef = useRef(new Set<string>())
  const completedRequestsRef = useRef(new Set<string>())
  const lastPulseIdRef = useRef(0)
  const [fallbackMessage, setFallbackMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [resizing, setResizing] = useState(false)

  callbacksRef.current = { onDiceImpact, onError, onHeldToggle, onPhaseChange, onRollComplete }
  latestRef.current = { dice, held, lineUpAll, motionFollow, quality, releaseRequestId, request }

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) {
      setFallbackMessage('모션 감소 설정에 따라 간단한 주사위 화면을 사용합니다.')
      return
    }

    const container = containerRef.current
    if (!container) return
    let disposed = false
    let createdWorld: PhysicsDiceWorldInstance | null = null

    const completeOnce = (requestId: string, completedDice: PhysicsDiceSet) => {
      if (completedRequestsRef.current.has(requestId)) return
      completedRequestsRef.current.add(requestId)
      callbacksRef.current.onRollComplete(requestId, completedDice)
    }
    const callbacks: PhysicsDiceWorldCallbacks = {
      onDiceImpact: (index, strength) => callbacksRef.current.onDiceImpact?.(index, strength),
      onError: (error) => callbacksRef.current.onError?.(error),
      onHeldToggle: (index) => callbacksRef.current.onHeldToggle?.(index),
      onPhaseChange: (phase) => callbacksRef.current.onPhaseChange?.(phase),
      onResizeChange: setResizing,
      onRollComplete: completeOnce,
    }

    void loadPhysicsDiceWorld()
      .then(async ({ PhysicsDiceWorld }) => {
        if (disposed) return
        createdWorld = new PhysicsDiceWorld({
          callbacks,
          container,
          quality: latestRef.current.quality,
        })
        await createdWorld.init()
        if (disposed) return
        worldRef.current = createdWorld
        applyInitialSceneState(
          createdWorld,
          latestRef.current,
          startedRequestsRef.current,
          releasedRequestsRef.current,
        )
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (disposed) return
        const error = cause instanceof Error ? cause : new Error('3D 주사위 엔진 초기화 실패')
        createdWorld?.destroy()
        createdWorld = null
        worldRef.current = null
        setFallbackMessage('3D 엔진을 사용할 수 없어 간단한 주사위 화면으로 전환했습니다.')
        callbacksRef.current.onError?.(error)
      })

    return () => {
      disposed = true
      createdWorld?.destroy()
      worldRef.current = null
    }
  }, [])

  useEffect(() => {
    worldRef.current?.syncCommittedDice(dice, held)
  }, [dice, held])

  useEffect(() => {
    const world = worldRef.current
    if (!world || !request || startedRequestsRef.current.has(request.requestId)) return
    startedRequestsRef.current.add(request.requestId)
    world.startRoll(request)
  }, [request])

  // startRoll 뒤에 둔다 — 마지막 굴림이 시작되는 커밋에서는 씬이 이미 굴리는 중이어야
  // 값만 갈리고, 킵 주사위가 레일 → 줄 → 레일로 한 번 튀지 않는다.
  useEffect(() => {
    worldRef.current?.setLineUpAll(lineUpAll)
  }, [lineUpAll])

  useEffect(() => {
    const world = worldRef.current
    if (
      !world ||
      !request ||
      releaseRequestId !== request.requestId ||
      releasedRequestsRef.current.has(request.requestId)
    ) {
      return
    }
    releasedRequestsRef.current.add(request.requestId)
    world.pour()
  }, [releaseRequestId, request])

  useEffect(() => {
    worldRef.current?.applyQuality(quality)
  }, [quality])

  useEffect(() => {
    if (motionFollow === undefined) return
    worldRef.current?.setMotionFollow(motionFollow)
  }, [motionFollow])

  useEffect(() => {
    if (!motionPulse || motionPulse.id === lastPulseIdRef.current) return
    lastPulseIdRef.current = motionPulse.id
    worldRef.current?.applyShakePulse(motionPulse.direction, motionPulse.strength)
  }, [motionPulse])

  if (fallbackMessage) {
    return (
      <PhysicsDiceFallback
        dice={dice}
        held={held}
        message={fallbackMessage}
        releaseRequestId={releaseRequestId}
        request={request}
        {...(onHeldToggle ? { onHeldToggle } : {})}
        onRollComplete={onRollComplete}
      />
    )
  }

  return (
    <section
      className="absolute inset-0 overflow-hidden"
      aria-label="사발과 KEEP 슬롯이 있는 3D 주사위 트레이"
    >
      <div ref={containerRef} className="absolute inset-0" />
      {loading && (
        <div
          aria-live="polite"
          className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-surface/75 text-content-muted backdrop-blur-sm"
          role="status"
        >
          <span className="grid justify-items-center gap-2 text-sm font-semibold">
            <span
              aria-hidden="true"
              className="size-8 animate-spin-slow rounded-full border-3 border-border border-t-brand motion-reduce:animate-none"
            />
            3D 주사위 준비 중
          </span>
        </div>
      )}
      {resizing && (
        <div
          className="absolute inset-0 grid place-items-center bg-surface/75 font-mono text-xs text-content-muted backdrop-blur-sm"
          role="status"
        >
          3D 화면 크기를 조정하고 있어요.
        </div>
      )}
    </section>
  )
}
