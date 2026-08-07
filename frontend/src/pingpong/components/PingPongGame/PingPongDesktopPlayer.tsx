import type { RefObject } from 'react'
import { readyButtonLabel } from '@/pingpong/components/PingPongController/PreparationController'
import type { PingPongState, RoomSnapshot } from '@/realtime/wsEvents'
import { Button } from '@/shared/components/Button'
import { GameChromeButton } from '@/shared/components/GameChromeButton'
import { CourtOverlay } from './CourtOverlay'
import { PingPongPreparation } from './PingPongPreparation'

export function DesktopReadyButton({
  onReady,
  practiced,
  ready,
}: {
  onReady: () => void
  practiced: boolean
  ready: boolean
}) {
  return (
    <Button disabled={!practiced || ready} onClick={onReady} size="lg" type="button">
      {readyButtonLabel(practiced, ready)}
    </Button>
  )
}

export function PingPongDesktopPlayer({
  canvasRef,
  clock,
  error,
  onLeave,
  onReady,
  onSwing,
  playerId,
  snapshot,
  state,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  clock: number
  error: string | null
  onLeave: () => void
  onReady: () => void
  onSwing: () => void
  playerId: string
  snapshot: RoomSnapshot
  state: PingPongState
}) {
  return (
    <main className="relative h-svh w-full overflow-hidden bg-pp-canvas text-white">
      <canvas aria-label="3D 탁구 코트" className="absolute inset-0 size-full" ref={canvasRef} />
      <button
        aria-label="화면을 클릭해 스윙"
        className="absolute inset-0 size-full cursor-pointer"
        onClick={onSwing}
        type="button"
      />
      <GameChromeButton
        className="absolute top-20 left-4 z-20"
        tone="overlay"
        onClick={onLeave}
        type="button"
      >
        나가기
      </GameChromeButton>
      <CourtOverlay
        badge={`RALLY ${state.rally}`}
        clock={clock}
        preparation={
          state.phase === 'PREPARING' && (
            <PingPongPreparation
              action={
                <DesktopReadyButton
                  onReady={onReady}
                  practiced={(state.lastInputSeq[playerId] ?? -1) >= 0}
                  ready={state.readyPlayerIds.includes(playerId)}
                />
              }
              heading="스페이스바로 연습 공을 쳐보세요"
              snapshot={snapshot}
              state={state}
            />
          )
        }
        snapshot={snapshot}
        state={state}
      />
      <p className="pointer-events-none absolute inset-x-0 bottom-5 z-20 m-0 text-center text-sm text-game-content-muted">
        스페이스바 또는 화면 클릭으로 받아치기
      </p>
      {error && (
        <p
          className="absolute inset-x-0 bottom-12 z-20 m-0 text-center text-sm text-red-300"
          role="alert"
        >
          {error}
        </p>
      )}
    </main>
  )
}
