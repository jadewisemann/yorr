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
  /**
   * true면 킵하지 않은 주사위도 결과 줄이 아니라 킵 레일에 함께 오른다. 마지막 굴림부터 켜서
   * 다섯 개가 전부 레일에 올라간 그림을 만든다 — 그 뒤에는 킵을 바꿀 수 없다(S15P11A406-143).
   */
  keepAll?: boolean
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
  // 배치 규칙을 먼저 세운 뒤에 주사위를 놓는다 — 순서가 뒤집히면 한 번 잘못 눕는다.
  world.setKeepAll(latest.keepAll)
  world.syncCommittedDice(latest.dice, latest.held)

  const request = latest.request
  if (!request) return
  ledger.startOnce(request.requestId, () => world.startRoll(request))
  if (latest.releaseRequestId !== request.requestId) return
  ledger.releaseOnce(request.requestId, () => world.pour())
}

/**
 * 물리 주사위 월드의 수명주기 — 월드 로드, 리사이즈, 굴림·킵·릴리스 요청 반영,
 * 모션 흔들기 펄스, 실패 시 2D 대체로 떨어지는 판단.
 *
 * 화면(`PhysicsDiceScene`)은 이 훅이 돌려주는 네 값만 그린다. 콜백·최신 props 를 ref 로
 * 들고 있는 이유는 rapier 스텝이 도는 중에 effect 를 다시 붙이지 않기 위해서다 — 리스너를
 * 다시 매는 것만으로도 프레임 예산을 갉아먹는다.
 */
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

  // 물리 월드는 effect 안에서 한 번 만들고 그 뒤로 콜백만 최신을 쓴다.
  const diceImpact = useEffectEvent((index: PhysicsDiceIndex, strength: number) =>
    onDiceImpact?.(index, strength),
  )
  const reportError = useEffectEvent((cause: Error) => onError?.(cause))
  const heldToggle = useEffectEvent((index: PhysicsDiceIndex) => onHeldToggle?.(index))
  const phaseChange = useEffectEvent((phase: PhysicsDicePhase) => onPhaseChange?.(phase))
  const rollComplete = useEffectEvent((requestId: string, completedDice: PhysicsDiceSet) =>
    onRollComplete(requestId, completedDice),
  )
  // 렌더 중에 ref를 쓰지 않는다 — 버려지는 렌더(동시성)에서 커밋되지 않은 값이 남는다.
  // layout effect는 페인트 전에 돌아서 이벤트·rAF가 읽는 시점에는 이미 최신이다.
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

  // startRoll 뒤에 둔다 — 마지막 굴림이 시작되는 커밋에서는 씬이 이미 굴리는 중이어야
  // 값만 갈리고, 킵 주사위가 레일 → 줄 → 레일로 한 번 튀지 않는다.
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
