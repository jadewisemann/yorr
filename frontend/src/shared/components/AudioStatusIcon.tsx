import { IconMic, IconSound } from './Icon'

interface AudioStatus {
  micOn: boolean
  muted: boolean
  peerCount?: number
}

export function audioLabel({ micOn, muted, peerCount = 0 }: AudioStatus) {
  const sound = muted ? '소리 꺼짐' : '소리 켜짐'
  if (!micOn) return `오디오 설정 · ${sound} · 마이크 꺼짐`
  return `오디오 설정 · ${sound} · 마이크 켜짐${peerCount > 0 ? ` · ${peerCount}명 연결됨` : ''}`
}

export function AudioStatusIcon({ micOn, muted }: Omit<AudioStatus, 'peerCount'>) {
  return (
    <span className="relative">
      <IconSound className="size-4.5" muted={muted} />
      {micOn && <IconMic className="absolute -top-1.5 -right-2 size-3 text-positive" />}
    </span>
  )
}
