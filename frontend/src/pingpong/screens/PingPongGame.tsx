import { PingPongDashboard } from '@/pingpong/components/PingPongGame/PingPongDashboard'
import { PingPongDesktopPlayer } from '@/pingpong/components/PingPongGame/PingPongDesktopPlayer'
import { usePingPongGame } from '@/pingpong/model/usePingPongGame'
import type { PingPongState, RoomSnapshot } from '@/realtime/wsEvents'
import { GameCanvas } from '@/shared/components/Screen'
import { useMediaQuery } from '@/shared/useMediaQuery'
import type { ActiveRoomSession } from '@/store'
import { PingPongController } from './PingPongController'

interface PingPongGameProps {
  onLeaveRequest: () => void
  roomId: string
  session: ActiveRoomSession
  snapshot: RoomSnapshot
}

const DESKTOP_PLAYER = '(min-width: 1024px) and (pointer: fine)'

export function PingPongGame({ onLeaveRequest, roomId, session, snapshot }: PingPongGameProps) {
  const dashboard = session.membershipRole === 'dashboard'
  const wideMouse = useMediaQuery(DESKTOP_PLAYER)
  const desktop = !dashboard && wideMouse
  const court = dashboard || desktop
  const state = snapshot.game as unknown as PingPongState | undefined

  const { canvasRef, clock, permission, ready, requestPermission, sendError, swing } =
    usePingPongGame({ court, dashboard, roomId, session, state })

  if (!state) {
    return (
      <GameCanvas className="grid place-items-center bg-pp-canvas">
        탁구 코트를 준비하고 있어요.
      </GameCanvas>
    )
  }

  if (dashboard) {
    return (
      <PingPongDashboard
        canvasRef={canvasRef}
        clock={clock}
        onClose={onLeaveRequest}
        snapshot={snapshot}
        state={state}
      />
    )
  }

  if (desktop) {
    return (
      <PingPongDesktopPlayer
        canvasRef={canvasRef}
        clock={clock}
        error={sendError}
        onLeave={onLeaveRequest}
        onReady={ready}
        onSwing={swing}
        playerId={session.you}
        snapshot={snapshot}
        state={state}
      />
    )
  }

  return (
    <PingPongController
      clock={clock}
      error={sendError}
      nickname={session.nickname}
      onLeave={onLeaveRequest}
      onReady={ready}
      onTouchSwing={swing}
      permission={permission}
      playerId={session.you}
      requestPermission={requestPermission}
      snapshot={snapshot}
      state={state}
    />
  )
}
