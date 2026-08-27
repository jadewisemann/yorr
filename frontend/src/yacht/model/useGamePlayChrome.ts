import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { readSoundMuted, saveSoundMuted } from '@/shared/audio/soundPreference'
import { setSoundtrackMuted } from '@/shared/audio/soundtrack'
import type { DiceIndex } from '@/yacht/domain/dice'
import type { YachtCategory } from '@/yacht/domain/scoring'
import { MAX_ROLLS, type YachtGameAction } from '@/yacht/domain/yachtGame'

interface UseGamePlayChromeOptions {
  activePlayerId: string | undefined
  phase: 'choosing' | string
  rollCount: number
  submitted: boolean
  setRollMuted: (muted: boolean) => void
  wide: boolean
}

export function useGamePlayChrome({
  activePlayerId,
  phase,
  rollCount,
  setRollMuted,
  submitted,
  wide,
}: UseGamePlayChromeOptions) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [zeroConfirm, setZeroConfirm] = useState<YachtCategory | null>(null)
  const [turnCallout, setTurnCallout] = useState<number | null>(null)
  const [soundMuted, setSoundMuted] = useState(readSoundMuted)
  const [audioOpen, setAudioOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const audioButtonRef = useRef<HTMLButtonElement>(null)
  const chatButtonRef = useRef<HTMLButtonElement>(null)

  const activePlayerRef = useRef(activePlayerId)
  useEffect(() => {
    if (activePlayerRef.current === activePlayerId) return
    activePlayerRef.current = activePlayerId
    setZeroConfirm(null)
    setSheetOpen(false)
  }, [activePlayerId])

  useEffect(() => {
    if (wide || submitted) return
    if (phase === 'choosing' && rollCount >= MAX_ROLLS) setSheetOpen(true)
  }, [phase, rollCount, submitted, wide])

  const closeSheet = useCallback(() => setSheetOpen(false), [])

  const toggleSound = () => {
    const muted = !soundMuted
    setSoundMuted(muted)
    saveSoundMuted(muted)
    setRollMuted(muted)
    setSoundtrackMuted(muted)
  }

  return {
    audioButtonRef,
    audioOpen,
    chatButtonRef,
    chatOpen,
    closeSheet,
    helpOpen,
    setAudioOpen,
    setChatOpen,
    setHelpOpen,
    setSheetOpen,
    setTurnCallout,
    setZeroConfirm,
    sheetOpen,
    soundMuted,
    toggleSound,
    turnCallout,
    zeroConfirm,
  }
}

export function useShortcuts(
  enabled: boolean,
  handlers: {
    dispatch: (action: YachtGameAction) => void
    onRoll: () => void
  },
) {
  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.target instanceof Element &&
      event.target.closest('a[href],button,input,select,textarea,[contenteditable],[role="button"]')
    ) {
      return
    }
    if (event.code === 'Space') {
      event.preventDefault()
      handlers.onRoll()
      return
    }
    const slot = Number(event.key)
    if (Number.isInteger(slot) && slot >= 1 && slot <= 5) {
      handlers.dispatch({ type: 'holdToggled', index: (slot - 1) as DiceIndex })
    }
  })

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => handleKeyDown(event)
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}

export function useMyTurnAlert({ isMyTurn, onAlert }: { isMyTurn: boolean; onAlert: () => void }) {
  const wasMyTurnRef = useRef(false)
  const alert = useEffectEvent(onAlert)

  useEffect(() => {
    if (isMyTurn && !wasMyTurnRef.current) alert()
    wasMyTurnRef.current = isMyTurn
  }, [isMyTurn])
}

export function useRoundStartNotice({
  onNotice,
  roundNumber,
}: {
  onNotice: () => void
  roundNumber: number
}) {
  const previousRoundRef = useRef<number | null>(null)
  const notice = useEffectEvent(onNotice)

  useEffect(() => {
    const previous = previousRoundRef.current
    previousRoundRef.current = roundNumber
    if (previous === null || previous === roundNumber) return
    notice()
  }, [roundNumber])
}

export function vibrateForMyTurn() {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate([90, 60, 90])
  } catch {}
}
