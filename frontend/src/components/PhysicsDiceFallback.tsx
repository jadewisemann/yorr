import { useEffect, useMemo, useRef } from 'react'
import { createPhysicsDiceRandom } from '@/rendering/physics-dice/random'
import type {
  PhysicsDiceIndex,
  PhysicsDiceRollRequest,
  PhysicsDiceSet,
  PhysicsHeldDice,
} from '@/rendering/physics-dice/types'
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
  const rolledDice = useMemo(
    () => (request ? rollFallbackDice(request, dice) : null),
    [dice, request],
  )
  const displayedDice =
    request && releaseRequestId === request.requestId && rolledDice
      ? rolledDice
      : (dice ?? INITIAL_DICE)

  useEffect(() => {
    if (
      !request ||
      !rolledDice ||
      releaseRequestId !== request.requestId ||
      completedRef.current.has(request.requestId)
    ) {
      return
    }
    const frame = requestAnimationFrame(() => {
      if (completedRef.current.has(request.requestId)) return
      completedRef.current.add(request.requestId)
      onRollCompleteRef.current(request.requestId, rolledDice)
    })
    return () => cancelAnimationFrame(frame)
  }, [releaseRequestId, request, rolledDice])

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
            className="rounded-card disabled:cursor-default"
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

function rollFallbackDice(
  request: PhysicsDiceRollRequest,
  currentDice: PhysicsDiceSet | null,
): PhysicsDiceSet {
  const random = createPhysicsDiceRandom(request.seed)
  return INITIAL_DICE.map((_, index) =>
    request.held[index] && currentDice
      ? currentDice[index]
      : ((Math.floor(random.next() * 6) + 1) as PhysicsDiceSet[number]),
  ) as unknown as PhysicsDiceSet
}
