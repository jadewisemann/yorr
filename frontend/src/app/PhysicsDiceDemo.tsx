import { useRef, useState } from 'react'
import { Button } from '@/components/Button'
import { PhysicsDiceScene } from '@/components/PhysicsDiceScene'
import {
  createDiceSet,
  createRollRequest,
  type DiceIndex,
  type DiceSet,
  type HeldDice,
  isDiceSet,
  NO_HELD_DICE,
  nextRollSeed,
  toggleHeldDie,
} from '@/domain/dice'
import type {
  PhysicsDiceMotionPulse,
  PhysicsDicePhase,
  PhysicsDiceQuality,
  PhysicsDiceRollRequest,
} from '@/rendering/physics-dice/types'

export function PhysicsDiceDemo() {
  const [dice, setDice] = useState<DiceSet | null>(null)
  const [held, setHeld] = useState<HeldDice>(NO_HELD_DICE)
  const [request, setRequest] = useState<PhysicsDiceRollRequest | null>(null)
  const [releaseRequestId, setReleaseRequestId] = useState<string | null>(null)
  const [quality, setQuality] = useState<PhysicsDiceQuality>('balanced')
  const [phase, setPhase] = useState<PhysicsDicePhase>('idle')
  const [forcedTargetInput, setForcedTargetInput] = useState('')
  const [motionFollow, setMotionFollow] = useState(false)
  const [motionPulse, setMotionPulse] = useState<PhysicsDiceMotionPulse | null>(null)
  const seedRef = useRef(73)
  const requestSequenceRef = useRef(0)
  const pulseSequenceRef = useRef(0)

  const sendPulse = () => {
    pulseSequenceRef.current += 1
    setMotionPulse({
      id: pulseSequenceRef.current,
      direction: pulseSequenceRef.current % 2 === 0 ? 'right' : 'left',
      strength: 0.8,
    })
  }
  const forcedValues = forcedTargetInput
    .replace(/[^1-6]/g, '')
    .split('')
    .map(Number)
  const forcedTarget = isDiceSet(forcedValues) ? createDiceSet(forcedValues) : null
  const roll = () => {
    if (request) return
    requestSequenceRef.current += 1
    const heldSafeTarget = forcedTarget
      ? createDiceSet(
          forcedTarget.map((value, index) =>
            held[index] && dice ? (dice[index] ?? value) : value,
          ),
        )
      : null
    const nextRequest = createRollRequest({
      held,
      requestId: `dev-roll-${requestSequenceRef.current}`,
      seed: seedRef.current,
      currentDice: dice,
      ...(heldSafeTarget ? { targetDice: heldSafeTarget } : {}),
    })
    setReleaseRequestId(null)
    setRequest(nextRequest)
  }

  const complete = (requestId: string, completedDice: DiceSet) => {
    if (!request || request.requestId !== requestId) return
    setDice(completedDice)
    seedRef.current = nextRollSeed(request.seed)
    setReleaseRequestId(null)
    setRequest(null)
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
        <Button
          variant="secondary"
          onClick={() => setReleaseRequestId(request?.requestId ?? null)}
          disabled={!request || phase !== 'shaking'}
        >
          던지기
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
        <label className="flex items-center gap-2 text-sm text-content-muted">
          목표값 강제
          <input
            className="w-24 rounded-control border border-border bg-surface-raised px-3 py-2 font-mono text-content"
            value={forcedTargetInput}
            placeholder="예: 66666"
            maxLength={5}
            disabled={Boolean(request)}
            onChange={(event) => setForcedTargetInput(event.target.value)}
            aria-label="다음 굴림의 목표값 다섯 자리 (1-6)"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-content-muted">
          <input
            type="checkbox"
            checked={motionFollow}
            onChange={(event) => setMotionFollow(event.target.checked)}
          />
          모션 팔로우
        </label>
        <Button
          variant="secondary"
          onClick={sendPulse}
          disabled={!motionFollow || phase !== 'shaking'}
        >
          흔들기 펄스
        </Button>
        <span className="font-mono text-xs text-content-muted">
          PHASE: {phase}
          {request ? ` · TARGET: ${request.targetDice.join('')}` : ''}
        </span>
      </div>
      <div className="relative h-[560px] min-h-[420px] overflow-hidden rounded-panel border border-border [background:var(--ds-physics-tray)]">
        <PhysicsDiceScene
          dice={dice}
          held={held}
          motionFollow={motionFollow}
          motionPulse={motionPulse}
          releaseRequestId={releaseRequestId}
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
