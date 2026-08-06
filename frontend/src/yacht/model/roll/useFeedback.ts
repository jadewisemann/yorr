import { useCallback, useEffect, useRef, useState } from 'react'
import { readSoundMuted } from '@/shared/audio/soundPreference'
import type { DiceIndex, DiceSet } from '@/yacht/domain/dice'
import { detectSpecialHand, type SpecialHand } from '@/yacht/domain/specialHands'
import { createRollFeedback } from '@/yacht/feedback/createRollFeedback'
import { createHandVoice, type HandVoice } from '@/yacht/feedback/handVoice'
import type { PhysicsDiceMotionPulse, PhysicsDicePhase } from '@/yacht/rendering/physics-dice/types'

/**
 * 굴림에 붙는 감각 — 소리(효과음·족보 음성)와 그 시각적 짝(흔들기 파동·족보 하이라이트).
 *
 * 굴림 상태 기계와 분리해 둔 이유는 <b>둘이 서로를 몰라도 되기 때문</b>이다. 상태 기계는
 * "무엇이 일어났는가"만 알리고, 여기서 그것을 어떻게 들려주고 보여줄지 정한다.
 *
 * 흔들기 파동(`motionPulse`)이 소리와 같은 자리에 있는 이유: 파동은 흔들림 효과음의 시각적
 * 짝이라 항상 같이 나야 한다. 둘을 갈라 두면 한쪽만 나는 상태가 생긴다.
 */
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

  /** 흔들림 한 번 — 소리와 파동이 함께 난다. 파동 id는 같은 세기라도 다시 그리게 하는 키다. */
  const pulse = useCallback(
    (direction: 'left' | 'right', strength: number, source: 'local' | 'remote') => {
      if (source === 'remote') feedbackRef.current?.remoteShakePulse()
      else feedbackRef.current?.shakePulse(direction, strength)
      pulseSequenceRef.current += 1
      setMotionPulse({ direction, id: pulseSequenceRef.current, strength })
    },
    [],
  )

  /**
   * 굴림 결과에 족보가 섰으면 하이라이트를 세운다. 이미 기록한 족보는 세지 않는다 —
   * 판정은 호출부가 아는 것(내 점수판)이라 술어로 받는다.
   */
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
