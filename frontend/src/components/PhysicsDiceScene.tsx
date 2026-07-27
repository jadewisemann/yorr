import { useEffect, useRef, useState } from 'react'
import type {
  PhysicsDiceIndex,
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
  releaseRequestId: string | null
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
const DIE_KEYS = ['die-1', 'die-2', 'die-3', 'die-4', 'die-5'] as const

export function PhysicsDiceScene({
  dice,
  held,
  releaseRequestId,
  onError,
  onHeldToggle,
  onPhaseChange,
  onRollComplete,
  quality = 'balanced',
  request,
}: PhysicsDiceSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<PhysicsDiceWorldInstance | null>(null)
  const callbacksRef = useRef({ onError, onHeldToggle, onPhaseChange, onRollComplete })
  const latestRef = useRef({ dice, held, quality, releaseRequestId, request })
  const startedRequestsRef = useRef(new Set<string>())
  const releasedRequestsRef = useRef(new Set<string>())
  const completedRequestsRef = useRef(new Set<string>())
  const [fallbackMessage, setFallbackMessage] = useState<string | null>(null)
  const [resizing, setResizing] = useState(false)

  callbacksRef.current = { onError, onHeldToggle, onPhaseChange, onRollComplete }
  latestRef.current = { dice, held, quality, releaseRequestId, request }

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
      onError: (error) => callbacksRef.current.onError?.(error),
      onHeldToggle: (index) => callbacksRef.current.onHeldToggle?.(index),
      onPhaseChange: (phase) => callbacksRef.current.onPhaseChange?.(phase),
      onResizeChange: setResizing,
      onRollComplete: completeOnce,
    }

    void import('@/rendering/physics-dice/World')
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
        const latest = latestRef.current
        createdWorld.applyQuality(latest.quality)
        createdWorld.syncCommittedDice(latest.dice, latest.held)
        if (latest.request && !startedRequestsRef.current.has(latest.request.requestId)) {
          startedRequestsRef.current.add(latest.request.requestId)
          createdWorld.startRoll(latest.request)
        }
        if (
          latest.request &&
          latest.releaseRequestId === latest.request.requestId &&
          !releasedRequestsRef.current.has(latest.request.requestId)
        ) {
          releasedRequestsRef.current.add(latest.request.requestId)
          createdWorld.pour()
        }
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
      {dice && (
        <fieldset className="absolute inset-x-2 bottom-2 z-10 flex justify-center gap-2">
          <legend className="sr-only">주사위 KEEP 선택</legend>
          {dice.map((value, index) => (
            <button
              key={DIE_KEYS[index]}
              type="button"
              className="min-h-11 min-w-11 rounded-control border border-border bg-surface/90 px-3 py-2 font-bold shadow-raised backdrop-blur-sm disabled:cursor-default disabled:opacity-60"
              disabled={!onHeldToggle || Boolean(request)}
              onClick={() => onHeldToggle?.(index as PhysicsDiceIndex)}
              aria-label={`${index + 1}번 주사위, ${value}${held[index] ? ', KEEP 해제' : ', KEEP'}`}
              aria-pressed={held[index] ?? false}
            >
              {value}
            </button>
          ))}
        </fieldset>
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
