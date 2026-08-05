import { cn } from '@/shared/cn'
import { IconMic } from '@/shared/components/Icon'
import type { PlayerId } from '../wsEvents'
import type { VoiceChat } from './useVoiceChat'

interface PeerMicButtonProps {
  className?: string
  playerId: PlayerId
  voice: VoiceChat
}

/**
 * 참가자 한 명의 마이크 — 이름표 오른쪽 끝에 서서 두 가지를 한다.
 *   1. 지금 말하고 있는지 보여준다(초록 + 펄스)
 *   2. 누르면 그 사람 소리만 끈다("저 사람 목소리는 안 듣고 싶다")
 *
 * 통화 중이 아니거나 그 사람이 음성 채널에 없으면 아무것도 그리지 않는다 — 마이크를 켜지도
 * 않은 사람 옆에 끌 수 있는 마이크가 있으면 무슨 뜻인지 읽히지 않는다.
 *
 * 끄는 것은 **내 쪽 재생만** 막는다. 상대는 내가 자기 소리를 껐다는 사실을 알 수 없고
 * (계약에 관련 메시지가 없다) 연결도 그대로 유지된다.
 */
export function PeerMicButton({ className, playerId, voice }: PeerMicButtonProps) {
  if (voice.status !== 'on' || !voice.peers.includes(playerId)) return null

  const muted = voice.mutedPeers.has(playerId)
  const speaking = voice.speaking.has(playerId)

  return (
    <button
      aria-label={muted ? '이 사람 소리 켜기' : '이 사람 소리 끄기'}
      aria-pressed={muted}
      className={cn(
        'relative grid size-6 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-xs leading-none transition-opacity focus-visible:outline-2 focus-visible:outline-focus',
        // 글리프는 작게 두고 누를 수 있는 영역만 넓힌다 — 24px 아이콘을 그대로 탭 타깃으로
        // 쓰면 모바일에서 못 누른다(권장 최소 44px). before는 레이아웃에 영향이 없다.
        'before:absolute before:-inset-2.5 before:content-[""]',
        // 말하는 중은 밝게, 조용하면 눌러 둔다. 껐으면 가장 흐리다.
        muted ? 'opacity-45' : speaking ? 'opacity-100' : 'opacity-70',
        className,
      )}
      onClick={(event) => {
        // 부모 카드가 클릭을 가진 화면(대기실 카드 등)에서 같이 발동하지 않게 한다.
        event.stopPropagation()
        voice.toggleMutePeer(playerId)
      }}
      type="button"
    >
      {/* 이모지가 아니라 공용 SVG다 — 이모지는 currentColor를 따르지 않아 흐리게(opacity)
          눌러도 플랫폼 색이 그대로 남고, 말하는 중 초록 링과 색이 어긋난다(Icon.tsx 주석). */}
      <IconMic className="size-4" />
      {/* 껐다는 표시는 사선. 흐려지는 것만으로는 "조용한 사람"과 구분되지 않는다. */}
      {muted && (
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-1/2 h-[2px] w-5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full bg-danger shadow-[0_0_0_1px_rgb(0_0_0_/_55%)]"
        />
      )}
      {/* 말하는 중은 초록 링으로도 알린다 — 투명도만으로는 옆 칩과 비교해야 읽힌다. */}
      {speaking && !muted && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full ring-2 ring-positive motion-safe:animate-ring-pulse"
        />
      )}
    </button>
  )
}
