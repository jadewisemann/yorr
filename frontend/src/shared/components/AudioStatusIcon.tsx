import { IconSound } from './Icon'

interface AudioStatus {
  muted: boolean
}

export function audioLabel({ muted }: AudioStatus) {
  return `오디오 설정 · ${muted ? '소리 꺼짐' : '소리 켜짐'}`
}

export function AudioStatusIcon({ muted }: AudioStatus) {
  return <IconSound className="size-4.5" muted={muted} />
}
