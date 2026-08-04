import { cn } from '@/shared/cn'
import type { VoiceChat } from './useVoiceChat'

interface VoiceButtonProps {
  className?: string
  voice: VoiceChat
}

/**
 * 마이크 토글 하나. 지속 상태라 소리(🔊) 토글과 같은 성격이고 같은 모양을 쓴다.
 *
 * 마이크를 쓸 수 없는 환경(HTTPS 아님·기기 없음)에서는 아무것도 그리지 않는다 —
 * 눌러도 실패하는 버튼을 남겨두면 사용자가 자기 잘못이라고 생각한다.
 */
export function VoiceButton({ className, voice }: VoiceButtonProps) {
  if (voice.status === 'unsupported') return null

  const on = voice.status === 'on'
  const requesting = voice.status === 'requesting'
  const denied = voice.status === 'denied'

  return (
    <button
      aria-busy={requesting || undefined}
      aria-label={voiceLabel(voice)}
      aria-pressed={on}
      className={cn(
        'relative grid size-tap flex-none cursor-pointer place-items-center rounded-card border text-[15px] transition-colors focus-visible:outline-3 focus-visible:outline-focus',
        on
          ? 'border-brand bg-brand/15 text-content'
          : 'border-border bg-surface text-content-muted hover:text-content',
        denied && 'border-warning/50',
        requesting && 'cursor-progress',
        className,
      )}
      disabled={requesting}
      onClick={voice.toggle}
      type="button"
    >
      {/* 꺼진 상태도 마이크 글리프를 유지한다. 🔇로 바꾸면 바로 옆 소리 토글(🔊/🔇)과 같은
          스피커 모양이 되어 "게임 소리"와 "내 마이크"가 구분되지 않는다. 상태는 색·테두리와
          아래 사선이 말한다. */}
      <span aria-hidden="true" className={cn('relative', !on && 'opacity-70')}>
        🎙️
        {!on && !requesting && (
          <span className="absolute top-1/2 left-1/2 h-[1.5px] w-5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full bg-content-muted" />
        )}
      </span>

      {/* 연결된 상대 수. 0명이면 숨긴다 — "혼자 켜둔 상태"를 0으로 강조할 이유가 없다. */}
      {on && voice.peers.length > 0 && (
        <span
          aria-hidden="true"
          className="absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full bg-brand px-1 font-mono text-[10px] leading-4 font-bold text-on-brand tabular-nums"
        >
          {voice.peers.length}
        </span>
      )}

      {/* 권한 거부는 색만으로 알리지 않는다 — 색각 이상·저대비에서 가장 먼저 사라지는 채널이다. */}
      {denied && (
        <span
          aria-hidden="true"
          className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-warning text-[10px] leading-none font-bold text-on-inverse"
        >
          !
        </span>
      )}
    </button>
  )
}

function voiceLabel(voice: VoiceChat) {
  if (voice.status === 'requesting') return '마이크 권한 요청 중'
  if (voice.status === 'denied') return '마이크 권한이 거부됨 · 다시 시도'
  if (voice.status === 'on') {
    return voice.peers.length > 0
      ? `음성 채팅 끄기 · ${voice.peers.length}명 연결됨`
      : '음성 채팅 끄기 · 연결 대기 중'
  }
  return '음성 채팅 켜기'
}
