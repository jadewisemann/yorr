import { useEffect, useRef } from 'react'
import type {
  PhysicsDiceIndex,
  PhysicsDiceRollRequest,
  PhysicsDiceSet,
  PhysicsHeldDice,
} from '@/yacht/rendering/physics-dice/types'
import { Dice } from './Dice'

type PhysicsDiceFallbackProps = {
  dice: PhysicsDiceSet | null
  held: PhysicsHeldDice
  message?: string
  onHeldToggle?: (index: PhysicsDiceIndex) => void
  onRollComplete: (requestId: string, dice: PhysicsDiceSet) => void
  releaseRequestId: string | null
  request: PhysicsDiceRollRequest | null
}

const INITIAL_DICE: PhysicsDiceSet = [1, 2, 3, 4, 5]
const DIE_KEYS = ['die-1', 'die-2', 'die-3', 'die-4', 'die-5'] as const

export function PhysicsDiceFallback({
  dice,
  held,
  message,
  onHeldToggle,
  onRollComplete,
  releaseRequestId,
  request,
}: PhysicsDiceFallbackProps) {
  const onRollCompleteRef = useRef(onRollComplete)
  const completedRef = useRef(new Set<string>())
  onRollCompleteRef.current = onRollComplete
  const displayedDice =
    request && releaseRequestId === request.requestId ? request.targetDice : (dice ?? INITIAL_DICE)

  useEffect(() => {
    if (
      !request ||
      releaseRequestId !== request.requestId ||
      completedRef.current.has(request.requestId)
    ) {
      return
    }
    const frame = requestAnimationFrame(() => {
      if (completedRef.current.has(request.requestId)) return
      completedRef.current.add(request.requestId)
      onRollCompleteRef.current(request.requestId, request.targetDice)
    })
    return () => cancelAnimationFrame(frame)
  }, [releaseRequestId, request])

  return (
    <section
      className="absolute inset-0 grid content-center gap-6 bg-surface/70 p-5"
      aria-label="2D 주사위 대체 화면"
    >
      {message && (
        <p className="m-0 text-center text-sm text-content-muted" role="status">
          {message}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-3">
        {displayedDice.map((value, index) => (
          <button
            key={DIE_KEYS[index]}
            type="button"
            className="cursor-pointer rounded-card focus-visible:outline-3 focus-visible:outline-focus focus-visible:outline-offset-2 disabled:cursor-default"
            disabled={!onHeldToggle || Boolean(request)}
            onClick={() => onHeldToggle?.(index as PhysicsDiceIndex)}
            aria-label={`${value} 주사위${held[index] ? ' KEEP 해제' : ' KEEP'}`}
            aria-pressed={held[index] ?? false}
          >
            <Dice value={value} held={held[index] ?? false} rolling={Boolean(request)} size="sm" />
          </button>
        ))}
      </div>
    </section>
  )
}
