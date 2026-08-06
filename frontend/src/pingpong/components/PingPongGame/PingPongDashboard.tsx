import type { RefObject } from 'react'
import type { PingPongState, RoomSnapshot } from '@/realtime/wsEvents'
import { GameChromeButton } from '@/shared/components/GameChromeButton'
import { CourtOverlay } from './CourtOverlay'
import { PingPongPreparation } from './PingPongPreparation'

export function PingPongDashboard({
  canvasRef,
  clock,
  onClose,
  snapshot,
  state,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  clock: number
  onClose: () => void
  snapshot: RoomSnapshot
  state: PingPongState
}) {
  return (
    <main className="relative h-svh w-full overflow-hidden bg-pp-canvas text-white">
      <canvas
        aria-label="파티 모드 3D 탁구 코트"
        className="absolute inset-0 size-full"
        ref={canvasRef}
      />
      <GameChromeButton
        className="absolute top-20 left-4 z-20"
        tone="overlay"
        onClick={onClose}
        type="button"
      >
        방 닫기
      </GameChromeButton>
      <CourtOverlay
        badge={`PARTY · RALLY ${state.rally}`}
        clock={clock}
        preparation={
          state.phase === 'PREPARING' && (
            <PingPongPreparation
              heading="휴대폰으로 연습 공을 쳐보세요"
              snapshot={snapshot}
              state={state}
            />
          )
        }
        snapshot={snapshot}
        state={state}
      />
      <p className="pointer-events-none absolute inset-x-0 bottom-5 z-20 m-0 text-center text-sm text-white/55">
        두 플레이어가 각자 휴대폰으로 조작하고 있어요.
      </p>
    </main>
  )
}
