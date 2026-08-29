import { PingPongDashboard } from '@/pingpong/components/PingPongGame/PingPongDashboard'
import { PingPongDesktopPlayer } from '@/pingpong/components/PingPongGame/PingPongDesktopPlayer'
import { usePartyHostGame } from '@/pingpong/model/usePartyHostGame'
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
  const serverState = snapshot.game as unknown as PingPongState | undefined

  /*
   * 파티 모드에서는 **대시보드가 랠리를 판정한다**(ADR-0003). 대시보드 세션은 파티 방에만
   * 있으므로 `dashboard`가 곧 그 조건이다.
   *
   * 대시보드는 자기가 판정한 상태로 그린다 — 서버를 돌아 온 상태로 그리면 판정을 내린
   * 이유가 사라진다. 판정 전(PREPARING)에는 서버 상태가 그대로 근거다.
   */
  const host = usePartyHostGame({ base: serverState, enabled: dashboard, roomId })
  const state = dashboard ? (host.hostState ?? serverState) : serverState

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
        canvasRef={host.canvasRef}
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
