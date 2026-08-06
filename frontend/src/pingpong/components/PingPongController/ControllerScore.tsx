import type { PaddleTone, PlayerSlot } from '@/pingpong/components/PingPongController/types'
import type { PingPongState } from '@/realtime/wsEvents'

/** 대시보드·코트와 같은 P1(왼쪽·파랑)·P2(오른쪽·빨강) 순서로 두 슬롯을 만든다. */
export function playerSlots(
  state: PingPongState,
  playerId: string,
  opponentName: string,
): [PlayerSlot, PlayerSlot] {
  const slot = (index: 0 | 1, tag: 'P1' | 'P2', tone: PaddleTone): PlayerSlot => {
    const id = state.playerOrder[index] ?? ''
    return { id, label: playerId === id ? '나' : opponentName, tag, tone }
  }
  return [slot(0, 'P1', 'blue'), slot(1, 'P2', 'red')]
}

export function ControllerScore({
  label,
  score,
  tag,
  tone,
}: {
  label: string
  score: number
  tag: string
  tone: 'blue' | 'red'
}) {
  return (
    <div className={tone === 'blue' ? 'text-pp-side-blue-text' : 'text-pp-danger-text'}>
      <span className="flex max-w-24 items-center gap-1 text-xs font-bold text-white/55">
        <span className="rounded-xs border border-current px-1 font-mono text-2xs font-black leading-none">
          {tag}
        </span>
        <span className="truncate">{label}</span>
      </span>
      <strong className="font-mono text-3xl leading-none">{score}</strong>
    </div>
  )
}
