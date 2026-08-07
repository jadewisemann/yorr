import { cn } from '@/shared/cn'
import { IconMic } from '@/shared/components/Icon'
import type { PlayerId } from '../wsEvents'
import type { VoiceChat } from './useVoiceChat'

interface PeerMicButtonProps {
  className?: string
  playerId: PlayerId
  voice: VoiceChat
}

export function PeerMicButton({ className, playerId, voice }: PeerMicButtonProps) {
  if (voice.status !== 'on' || !voice.peers.includes(playerId)) return null

  const muted = voice.mutedPeers.has(playerId)
  const speaking = voice.speaking.has(playerId)

  return (
    <button
      aria-label={muted ? '이 사람 소리 켜기' : '이 사람 소리 끄기'}
      aria-pressed={muted}
      className={cn(
        'relative grid size-6 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-xs leading-none transition-opacity focus-visible:outline-2 focus-visible:outline-focus active:scale-90',
        'before:absolute before:-inset-2.5 before:content-[""]',
        muted ? 'opacity-45' : speaking ? 'opacity-100' : 'opacity-70',
        className,
      )}
      onClick={(event) => {
        event.stopPropagation()
        voice.toggleMutePeer(playerId)
      }}
      type="button"
    >
      <IconMic className="size-4" />
      {muted && (
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-1/2 h-[2px] w-5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full bg-danger shadow-[0_0_0_1px_rgb(0_0_0_/_55%)]"
        />
      )}
      {speaking && !muted && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full ring-2 ring-positive motion-safe:animate-ring-pulse"
        />
      )}
    </button>
  )
}
