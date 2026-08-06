import { useRef, useState } from 'react'
import { readSoundMuted, saveSoundMuted } from '@/shared/audio/soundPreference'
import { setSoundtrackMuted } from '@/shared/audio/soundtrack'

/** 말풍선 하나 — 열림 상태와 붙을 자리(앵커 버튼)를 함께 들고 다닌다. */
function usePopoverAnchor() {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  return { buttonRef, close: () => setOpen(false), open, show: () => setOpen(true) }
}

/**
 * 대기실이 자기 안에서만 쓰는 UI 상태 — 말풍선 둘, 나가기 확인, 소리 토글.
 * 방 상태와 섞지 않는다: 이것들은 서버가 모르고, 새로고침하면 사라져도 되는 것들이다.
 */
export function useLobbyChrome() {
  const audio = usePopoverAnchor()
  const invite = usePopoverAnchor()
  const [exitRequested, setExitRequested] = useState(false)
  const [soundMuted, setSoundMuted] = useState(readSoundMuted)

  return {
    audio,
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
