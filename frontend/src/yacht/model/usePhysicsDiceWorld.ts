import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { createRollRequestLedger, type RollRequestLedger } from '@/yacht/model/roll/requestLedger'
import { loadPhysicsDiceWorld } from '@/yacht/rendering/physics-dice/loadWorld'
import type {
  PhysicsDiceIndex,
  PhysicsDiceMotionPulse,
  PhysicsDicePhase,
  PhysicsDiceQuality,
  PhysicsDiceRollRequest,
  PhysicsDiceSet,
  PhysicsDiceWorldCallbacks,
  PhysicsHeldDice,
} from '@/yacht/rendering/physics-dice/types'

export type PhysicsDiceSceneProps = {
  dice: PhysicsDiceSet | null
  held: PhysicsHeldDice
  keepAll?: boolean
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
  typeof import('@/yacht/rendering/physics-dice/World').PhysicsDiceWorld
>

type LatestSceneState = {
  dice: PhysicsDiceSet | null
  held: PhysicsHeldDice
  keepAll: boolean
  motionFollow: boolean | undefined
  quality: PhysicsDiceQuality
  releaseRequestId: string | null
  request: PhysicsDiceRollRequest | null
}

function applyInitialSceneState(
  world: PhysicsDiceWorldInstance,
  latest: LatestSceneState,
  ledger: RollRequestLedger,
) {
  world.applyQuality(latest.quality)
  if (latest.motionFollow !== undefined) world.setMotionFollow(latest.motionFollow)
  world.setKeepAll(latest.keepAll)
  world.syncCommittedDice(latest.dice, latest.held)

  const request = latest.request
  if (!request) return
  ledger.startOnce(request.requestId, () => world.startRoll(request))
  if (latest.releaseRequestId !== request.requestId) return
  ledger.releaseOnce(request.requestId, () => world.pour())
}

export function usePhysicsDiceWorld({
  dice,
  held,
  keepAll = false,
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
  const latestRef = useRef({
    dice,
    held,
    keepAll,
    motionFollow,
    quality,
    releaseRequestId,
    request,
  })
  const ledgerRef = useRef(createRollRequestLedger())
  const lastPulseIdRef = useRef(0)
  const [fallbackMessage, setFallbackMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [resizing, setResizing] = useState(false)

  const diceImpact = useEffectEvent((index: PhysicsDiceIndex, strength: number) =>
    onDiceImpact?.(index, strength),
  )
  const reportError = useEffectEvent((cause: Error) => onError?.(cause))
  const heldToggle = useEffectEvent((index: PhysicsDiceIndex) => onHeldToggle?.(index))
  const phaseChange = useEffectEvent((phase: PhysicsDicePhase) => onPhaseChange?.(phase))
  const rollComplete = useEffectEvent((requestId: string, completedDice: PhysicsDiceSet) =>
    onRollComplete(requestId, completedDice),
  )
  useLayoutEffect(() => {
    latestRef.current = { dice, held, keepAll, motionFollow, quality, releaseRequestId, request }
  })

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
      ledgerRef.current.completeOnce(requestId, () => rollComplete(requestId, completedDice))
    }
    const callbacks: PhysicsDiceWorldCallbacks = {
      onDiceImpact: (index, strength) => diceImpact(index, strength),
      onError: (cause) => reportError(cause),
      onHeldToggle: (index) => heldToggle(index),
      onPhaseChange: (phase) => phaseChange(phase),
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
        applyInitialSceneState(createdWorld, latestRef.current, ledgerRef.current)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (disposed) return
        const loadError = cause instanceof Error ? cause : new Error('3D 주사위 엔진 초기화 실패')
        createdWorld?.destroy()
        createdWorld = null
        worldRef.current = null
        setFallbackMessage('3D 엔진을 사용할 수 없어 간단한 주사위 화면으로 전환했습니다.')
        reportError(loadError)
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
    if (!world || !request) return
    ledgerRef.current.startOnce(request.requestId, () => world.startRoll(request))
  }, [request])

  useEffect(() => {
    worldRef.current?.setKeepAll(keepAll)
  }, [keepAll])

  useEffect(() => {
    const world = worldRef.current
    if (!world || !request || releaseRequestId !== request.requestId) return
    ledgerRef.current.releaseOnce(request.requestId, () => world.pour())
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
  return { containerRef, fallbackMessage, loading, resizing }
}
