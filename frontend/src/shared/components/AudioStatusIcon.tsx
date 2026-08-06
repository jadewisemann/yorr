import { IconMic, IconSound } from './Icon'

interface AudioStatus {
  micOn: boolean
  muted: boolean
  peerCount?: number
}

/** 시트를 열지 않고도 지금 상태가 읽히게 라벨에 소리·마이크를 함께 담는다. */
export function audioLabel({ micOn, muted, peerCount = 0 }: AudioStatus) {
  const sound = muted ? '소리 꺼짐' : '소리 켜짐'
  if (!micOn) return `오디오 설정 · ${sound} · 마이크 꺼짐`
  return `오디오 설정 · ${sound} · 마이크 켜짐${peerCount > 0 ? ` · ${peerCount}명 연결됨` : ''}`
}

/**
 * 소리 아이콘 + 통화 중일 때 마이크 배지. 대기실 헤더와 게임 헤더가 같은 입구를 쓰므로
 * 같은 그림이어야 같은 버튼으로 읽힌다.
 *
 * 마이크 배지는 초록으로 둔다 — 회색 소리 아이콘 위에 얹히므로 같은 색이면 배지가 아이콘의
 * 일부로 읽힌다. 아이콘 자체는 aria-hidden이고 접근 가능한 이름은 감싸는 버튼이 책임진다.
 */
export function AudioStatusIcon({ micOn, muted }: Omit<AudioStatus, 'peerCount'>) {
  return (
    <span className="relative">
      <IconSound className="size-4.5" muted={muted} />
      {micOn && <IconMic className="absolute -top-1.5 -right-2 size-3 text-positive" />}
    </span>
  )
}
