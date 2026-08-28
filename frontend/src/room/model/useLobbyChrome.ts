import { useRef, useState } from 'react'
import { readSoundMuted, saveSoundMuted } from '@/shared/audio/soundPreference'
import { setSoundtrackMuted } from '@/shared/audio/soundtrack'

function usePopoverAnchor() {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  return { buttonRef, close: () => setOpen(false), open, show: () => setOpen(true) }
}

export function useLobbyChrome() {
  const audio = usePopoverAnchor()
  const chat = usePopoverAnchor()
  const invite = usePopoverAnchor()
  const [exitRequested, setExitRequested] = useState(false)
  const [soundMuted, setSoundMuted] = useState(readSoundMuted)

  return {
    audio,
    chat,
    cancelExit: () => setExitRequested(false),
    exitRequested,
    invite,
    requestExit: () => setExitRequested(true),
    soundMuted,
    toggleMute: () => {
      const muted = !soundMuted
      setSoundMuted(muted)
      saveSoundMuted(muted)
      setSoundtrackMuted(muted)
    },
  }
}
