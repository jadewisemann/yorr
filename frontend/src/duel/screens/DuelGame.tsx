import { Arena } from '@/duel/components/Arena'
import { DuelButton } from '@/duel/components/DuelButton'
import { DuelDashboard } from '@/duel/components/DuelGame/DuelDashboard'
import { MAX_FOULS, MAX_HP } from '@/duel/domain/duel'
import { buildStage } from '@/duel/domain/stage'
import { useDuelGame } from '@/duel/model/useDuelGame'
import type { DuelState, RoomSnapshot } from '@/realtime/wsEvents'
import { isPartyRoom } from '@/room/partyControllerStorage'
import { GameChromeButton } from '@/shared/components/GameChromeButton'
import { GameCanvas } from '@/shared/components/Screen'
import type { ActiveRoomSession } from '@/store'
import { DuelController } from './DuelController'

interface DuelGameProps {
  onLeaveRequest: () => void
  roomId: string
  session: ActiveRoomSession
  snapshot: RoomSnapshot
}

type DuelModel = ReturnType<typeof useDuelGame>

interface DuelArenaProps {
  duel: Pick<DuelModel, 'draw' | 'flight' | 'impact' | 'impactDelay' | 'myShot' | 'permission'>
  opponentId: string
  opponentName: string
  state: DuelState
  you: string
}

/** 결투장 한 판. 화면 전체가 뽑기 버튼이다. */
function DuelArena({ duel, opponentId, opponentName, state, you }: DuelArenaProps) {
  const { draw, flight, impact, impactDelay, myShot } = duel
  const swinging = duel.permission === 'granted'
  return (
    <Arena
      {...buildStage({
        impact,
        opponentId,
        opponentName,
        state,
        you,
        youName: '나',
        youShot: myShot?.round === state.round ? myShot.target : null,
      })}
      actLabel={swinging ? '휘둘러!' : 'TAP'}
      flightMs={flight}
      fxKey={state.round}
      impactDelayMs={impactDelay}
      hint={swinging ? '초록이 되면 폰을 휘둘러 뽑아!' : '초록이 되면 화면을 탭 (스페이스바)!'}
      maxFouls={MAX_FOULS}
      maxHp={MAX_HP}
      round={state.round}
    >
      <button
        aria-label="뽑기"
        className="absolute inset-0 touch-none"
        onPointerDown={(event) => {
          event.preventDefault()
          draw('tap')
        }}
        type="button"
      />
    </Arena>
  )
}

/** 결투장 위에 뜨는 조작 — 나가기·센서 켜기·전송 오류. 뽑기 탭으로 새지 않게 막는다. */
function DuelOverlay({
  onLeaveRequest,
  permission,
  requestPermission,
  sendError,
}: Pick<DuelModel, 'permission' | 'requestPermission' | 'sendError'> & {
  onLeaveRequest: () => void
}) {
  return (
    <>
      <GameChromeButton
        className="absolute top-[max(0.75rem,env(safe-area-inset-top))] left-3 z-20"
        tone="overlay"
        onClick={(event) => {
          event.stopPropagation()
          onLeaveRequest()
        }}
        type="button"
      >
        나가기
      </GameChromeButton>

      <section className="absolute inset-x-0 bottom-0 z-20 grid justify-items-center gap-2 px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {permission === 'unknown' && (
          <DuelButton
            className="backdrop-blur-md"
            onClick={(event) => {
              event.stopPropagation()
              void requestPermission()
            }}
            variant="chip"
          >
            휴대폰 휘두르기 켜기
          </DuelButton>
        )}
        {sendError && (
          <p className="m-0 rounded-full bg-scrim-soft px-3 py-1 text-sm text-red-300" role="alert">
            {sendError}
          </p>
        )}
      </section>
    </>
  )
}

export function DuelGame({ onLeaveRequest, roomId, session, snapshot }: DuelGameProps) {
  const state = snapshot.game as unknown as DuelState | undefined
  const duel = useDuelGame({ roomId, session, state })
  const { draw, flight, impact, impactDelay, permission, requestPermission, sendError, stageRef } =
    duel

  if (!state) {
    return (
      <GameCanvas className="grid place-items-center bg-duel-canvas">
        결투장을 준비하고 있어요.
      </GameCanvas>
    )
  }

  if (session.membershipRole === 'dashboard') {
    return (
      <DuelDashboard
        flight={flight}
        impact={impact}
        impactDelayMs={impactDelay}
        onClose={onLeaveRequest}
        snapshot={snapshot}
        stageRef={stageRef}
        state={state}
      />
    )
  }

  const opponentId = state.playerOrder.find((playerId) => playerId !== session.you) ?? ''
  const opponent = snapshot.players.find((player) => player.playerId === opponentId)

  if (isPartyRoom(session.roomCode)) {
    return (
      <DuelController
        error={sendError}
        nickname={
          snapshot.players.find((player) => player.playerId === session.you)?.nickname ?? ''
        }
        onDraw={() => draw('tap')}
        onEnableMotion={() => void requestPermission()}
        onLeave={onLeaveRequest}
        opponentName={opponent?.nickname ?? '상대'}
        permission={permission}
        playerId={session.you}
        state={state}
      />
    )
  }

  return (
    <GameCanvas className="flex flex-col bg-duel-canvas select-none" ref={stageRef}>
      <DuelArena
        duel={duel}
        opponentId={opponentId}
        opponentName={opponent?.nickname ?? '상대'}
        state={state}
        you={session.you}
      />
      <DuelOverlay
        onLeaveRequest={onLeaveRequest}
        permission={permission}
        requestPermission={requestPermission}
        sendError={sendError}
      />
    </GameCanvas>
  )
}
