import { type RefObject, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
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

type WorldRefs = {
  containerRef: RefObject<HTMLDivElement | null>
  latestRef: RefObject<LatestSceneState>
  ledgerRef: RefObject<RollRequestLedger>
  worldRef: RefObject<PhysicsDiceWorldInstance | null>
}

type WorldEventKey =
  | 'onDiceImpact'
  | 'onError'
  | 'onHeldToggle'
  | 'onPhaseChange'
  | 'onRollComplete'
type WorldEventHandlers = { [K in WorldEventKey]: PhysicsDiceSceneProps[K] }

/**
 * 월드를 한 번 띄우고 언마운트 때 치운다. 엔진을 늦게 불러오므로 그 사이에 바뀐 props는
 * latestRef에서 읽어 한꺼번에 입힌다 — 아래 동기화 효과들은 월드가 없으면 그냥 지나간다.
 */
function useWorldMount(
  { containerRef, latestRef, ledgerRef, worldRef }: WorldRefs,
  { onDiceImpact, onError, onHeldToggle, onPhaseChange, onRollComplete }: WorldEventHandlers,
) {
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
  }, [containerRef, latestRef, ledgerRef, worldRef])

  return { fallbackMessage, loading, resizing }
}

type WorldSyncState = LatestSceneState & { motionPulse: PhysicsDiceMotionPulse | null | undefined }

/** 떠 있는 월드에 props 변화를 하나씩 흘려 보낸다. 굴림 시작·붓기는 ledger가 한 번만 통과시킨다. */
function useWorldSync(
  { ledgerRef, worldRef }: Pick<WorldRefs, 'ledgerRef' | 'worldRef'>,
  {
    dice,
    held,
    keepAll,
    motionFollow,
    motionPulse,
    quality,
    releaseRequestId,
    request,
  }: WorldSyncState,
) {
  const lastPulseIdRef = useRef(0)

  useEffect(() => {
    worldRef.current?.syncCommittedDice(dice, held)
  }, [worldRef, dice, held])

  useEffect(() => {
    const world = worldRef.current
    if (!world || !request) return
    ledgerRef.current.startOnce(request.requestId, () => world.startRoll(request))
  }, [ledgerRef, worldRef, request])

  useEffect(() => {
    worldRef.current?.setKeepAll(keepAll)
  }, [worldRef, keepAll])

  useEffect(() => {
    const world = worldRef.current
    if (!world || !request || releaseRequestId !== request.requestId) return
    ledgerRef.current.releaseOnce(request.requestId, () => world.pour())
  }, [ledgerRef, worldRef, releaseRequestId, request])

  useEffect(() => {
    worldRef.current?.applyQuality(quality)
  }, [worldRef, quality])

  useEffect(() => {
    if (motionFollow === undefined) return
    worldRef.current?.setMotionFollow(motionFollow)
  }, [worldRef, motionFollow])

  useEffect(() => {
    if (!motionPulse || motionPulse.id === lastPulseIdRef.current) return
    lastPulseIdRef.current = motionPulse.id
    worldRef.current?.applyShakePulse(motionPulse.direction, motionPulse.strength)
  }, [worldRef, motionPulse])
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
  const scene: LatestSceneState = {
    dice,
    held,
    keepAll,
    motionFollow,
    quality,
    releaseRequestId,
    request,
  }
  const containerRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<PhysicsDiceWorldInstance | null>(null)
  const latestRef = useRef(scene)
  const ledgerRef = useRef(createRollRequestLedger())
  const refs: WorldRefs = { containerRef, latestRef, ledgerRef, worldRef }

  useLayoutEffect(() => {
    latestRef.current = scene
  })

  const status = useWorldMount(refs, {
    onDiceImpact,
    onError,
    onHeldToggle,
    onPhaseChange,
    onRollComplete,
  })
  useWorldSync(refs, { ...scene, motionPulse })
  return { containerRef, ...status }
}
