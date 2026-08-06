import { PingPongDashboard } from '@/pingpong/components/PingPongGame/PingPongDashboard'
import { PingPongDesktopPlayer } from '@/pingpong/components/PingPongGame/PingPongDesktopPlayer'
import { usePingPongGame } from '@/pingpong/model/usePingPongGame'
import type { PingPongState, RoomSnapshot } from '@/realtime/wsEvents'
import { useMediaQuery } from '@/shared/useMediaQuery'
import type { ActiveRoomSession } from '@/store'
import { PingPongController } from './PingPongController'

interface PingPongGameProps {
  onLeaveRequest: () => void
  roomId: string
  session: ActiveRoomSession
  snapshot: RoomSnapshot
}

/**
 * 손에 쥔 기기가 아니라 <b>책상 앞 기기</b>인가.
 *
 * 빠른 대전으로 들어온 사람은 파티방과 같은 `participant`라서 방 종류로는 갈릴 수 없다 —
 * 데스크톱에서 빠대를 돌려도 폰용 라켓 컨트롤러가 떴다(S15P11A406-206). 폭만 보면 태블릿·
 * 가로로 돌린 큰 폰이 데스크톱으로 새고, 입력만 보면 마우스를 꽂은 태블릿이 샌다. 둘을
 * 함께 봐야 "키보드가 있고 화면이 넓은 기기"가 된다 — 야추가 폭으로 컨트롤러를 끄는
 * 것과 같은 판단에 입력 capability를 더한 것이다(`yacht/screens/GamePlay`).
 *
 * `pointer: fine`이 아닌 기기는 전부 컨트롤러로 떨어진다. 이쪽이 안전한 기본값이다 —
 * 폰에 큰 코트를 띄우면 라켓도 스코어도 읽히지 않지만, 데스크톱에 컨트롤러가 뜨면
 * 스페이스바로는 여전히 칠 수 있다.
 */
const DESKTOP_PLAYER = '(min-width: 1024px) and (pointer: fine)'

export function PingPongGame({ onLeaveRequest, roomId, session, snapshot }: PingPongGameProps) {
  const dashboard = session.membershipRole === 'dashboard'
  const wideMouse = useMediaQuery(DESKTOP_PLAYER)
  const desktop = !dashboard && wideMouse
  // 3D 코트를 띄우는 화면인가 = canvas가 마운트되는가.
  const court = dashboard || desktop
  const state = snapshot.game as unknown as PingPongState | undefined

  const { canvasRef, clock, permission, ready, requestPermission, sendError, swing } =
    usePingPongGame({ court, dashboard, roomId, session, state })

  if (!state) {
    return (
      <main className="grid h-svh place-items-center bg-pp-canvas text-white">
        탁구 코트를 준비하고 있어요.
      </main>
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

/**
 * 데스크톱으로 빠른 대전에 들어온 플레이어의 화면. (S15P11A406-206)
 *
 * 폰 컨트롤러와 <b>같은 게임, 다른 기기</b>다: 스윙은 스페이스바(전역 keydown)와 코트 클릭으로
 * 보내고, 점수·랠리·피드백은 대시보드와 같은 오버레이를 쓴다 — 손에 든 라켓 그림을 27인치
 * 화면에 띄우는 대신 자기 시점의 코트를 그대로 보여준다.
 *
 * `split`은 대시보드만 쓴다(`createFrameState`) — 여기서는 내 시점 한 화면이라 마스코트도
 * 상대 쪽만 서고 내 라켓이 손에 잡힌다.
 */

/**
 * 코트 위에 겹치는 HUD — 점수·랠리 배지·카운트다운·피드백. 대시보드와 데스크톱 플레이어가
 * 같은 코트를 보므로 같은 HUD를 쓴다.
 *
 * `preparation`을 자식으로 받는 이유는 <b>쌓이는 순서</b> 때문이다. 워밍업 카드와 피드백은
 * 둘 다 z-10이라 뒤에 오는 쪽이 위에 그려진다 — 카드 위에 피드백이 떠야 워밍업 중에도
 * 연습 스윙 라벨이 읽힌다. 형제로 두면 호출부 순서에 따라 이 관계가 뒤집힌다.
 */

/**
 * 코트 화면의 워밍업 카드. 대시보드는 구경만 하고(action 없음), 데스크톱 플레이어는 같은
 * 카드에서 준비 완료를 누른다 — 두 사람의 준비 상태를 보는 자리가 하나여야 "상대가 아직
 * 안 눌렀다"가 한눈에 읽힌다.
 */
