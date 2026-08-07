import { useCallback, useEffect, useRef, useState } from 'react'
import { readSoundMuted } from '@/shared/audio/soundPreference'
import type { DiceIndex, DiceSet } from '@/yacht/domain/dice'
import { detectSpecialHand, type SpecialHand } from '@/yacht/domain/specialHands'
import { createRollFeedback } from '@/yacht/feedback/createRollFeedback'
import { createHandVoice, type HandVoice } from '@/yacht/feedback/handVoice'
import type { PhysicsDiceMotionPulse, PhysicsDicePhase } from '@/yacht/rendering/physics-dice/types'

export function useRollFeedback() {
  const feedbackRef = useRef<ReturnType<typeof createRollFeedback> | null>(null)
  const handVoiceRef = useRef<HandVoice | null>(null)
  const pulseSequenceRef = useRef(0)
  const [motionPulse, setMotionPulse] = useState<PhysicsDiceMotionPulse | null>(null)
  const [rollHighlight, setRollHighlight] = useState<{ hand: SpecialHand; id: number } | null>(null)

  if (!feedbackRef.current) feedbackRef.current = createRollFeedback({ muted: readSoundMuted() })

  useEffect(() => () => feedbackRef.current?.dispose(), [])

  useEffect(() => {
    const voice = createHandVoice({ muted: readSoundMuted() })
    handVoiceRef.current = voice
    return () => {
      voice.dispose()
      handVoiceRef.current = null
    }
  }, [])

  useEffect(() => {
    if (rollHighlight) handVoiceRef.current?.play(rollHighlight.hand)
  }, [rollHighlight])

  const pulse = useCallback(
    (direction: 'left' | 'right', strength: number, source: 'local' | 'remote') => {
      if (source === 'remote') feedbackRef.current?.remoteShakePulse()
      else feedbackRef.current?.shakePulse(direction, strength)
      pulseSequenceRef.current += 1
      setMotionPulse({ direction, id: pulseSequenceRef.current, strength })
    },
    [],
  )

  const highlightSpecialHand = useCallback(
    (dice: DiceSet, isAlreadyRecorded: (candidate: SpecialHand) => boolean) => {
      const hand = detectSpecialHand(dice, isAlreadyRecorded)
      if (hand) setRollHighlight({ hand, id: Date.now() })
    },
    [],
  )

  return {
    armed: useCallback(() => feedbackRef.current?.armed(), []),
    diceImpact: useCallback(
      (index: DiceIndex, strength: number) => feedbackRef.current?.diceImpact(index, strength),
      [],
    ),
    dismissHighlight: useCallback(() => setRollHighlight(null), []),
    highlightSpecialHand,
    motionPulse,
    physicsError: useCallback(() => feedbackRef.current?.error(), []),
    phaseChanged: useCallback(
      (phase: PhysicsDicePhase) => feedbackRef.current?.phaseChanged(phase),
      [],
    ),
    pulse,
    rollHighlight,
    setMuted: useCallback((muted: boolean) => {
      feedbackRef.current?.setMuted(muted)
      handVoiceRef.current?.setMuted(muted)
    }, []),
    thrown: useCallback(() => feedbackRef.current?.thrown(), []),
  }
}
