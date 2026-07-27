import { useRef, useState } from 'react'
import { Button } from '@/components/Button'
import { PhysicsDiceScene } from '@/components/PhysicsDiceScene'
import {
  type DiceIndex,
  type DiceSet,
  type HeldDice,
  NO_HELD_DICE,
  planRoll,
  toggleHeldDie,
} from '@/domain/dice'
import type {
  PhysicsDicePhase,
  PhysicsDiceQuality,
  PhysicsDiceRollRequest,
} from '@/rendering/physics-dice/types'

export function PhysicsDiceDemo() {
  const [dice, setDice] = useState<DiceSet | null>(null)
  const [held, setHeld] = useState<HeldDice>(NO_HELD_DICE)
  const [request, setRequest] = useState<PhysicsDiceRollRequest | null>(null)
  const [quality, setQuality] = useState<PhysicsDiceQuality>('balanced')
  const [phase, setPhase] = useState<PhysicsDicePhase>('idle')
  const seedRef = useRef(73)
  const requestSequenceRef = useRef(0)
  const nextSeedRef = useRef(73)

  const roll = () => {
    if (request) return
    requestSequenceRef.current += 1
    const plan = planRoll({
      currentDice: dice,
      held,
      requestId: `dev-roll-${requestSequenceRef.current}`,
      seed: seedRef.current,
    })
    nextSeedRef.current = plan.nextSeed
    setRequest(plan)
  }

  const complete = (requestId: string, completedDice: DiceSet) => {
    setRequest((current) => {
      if (!current || current.requestId !== requestId) return current
      setDice(completedDice)
      seedRef.current = nextSeedRef.current
      return null
    })
  }

  const toggle = (index: DiceIndex) => {
    if (request || !dice) return
    setHeld((current) => toggleHeldDie(current, index))
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={roll} disabled={Boolean(request)}>
          {request ? '굴리는 중' : '3D 주사위 굴리기'}
        </Button>
        <label className="flex items-center gap-2 text-sm text-content-muted">
          품질
          <select
            className="rounded-control border border-border bg-surface-raised px-3 py-2 text-content"
            value={quality}
            disabled={Boolean(request)}
            onChange={(event) => setQuality(event.target.value as PhysicsDiceQuality)}
          >
            <option value="eco">ECO</option>
            <option value="balanced">BALANCED</option>
            <option value="high">HIGH</option>
          </select>
        </label>
        <span className="font-mono text-xs text-content-muted">PHASE: {phase}</span>
      </div>
      <div className="relative h-[560px] min-h-[420px] overflow-hidden rounded-panel border border-border [background:var(--ds-physics-tray)]">
        <PhysicsDiceScene
          dice={dice}
          held={held}
          request={request}
          quality={quality}
          onHeldToggle={toggle}
          onPhaseChange={setPhase}
          onRollComplete={complete}
        />
      </div>
    </div>
  )
}
