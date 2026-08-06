import { Arena } from '@/duel/components/Arena'
import { DuelDashboard } from '@/duel/components/DuelGame/DuelDashboard'
import { MAX_FOULS, MAX_HP } from '@/duel/domain/duel'
import { buildStage } from '@/duel/domain/stage'
import { useDuelGame } from '@/duel/model/useDuelGame'
import type { DuelState, RoomSnapshot } from '@/realtime/wsEvents'
import { isPartyRoom } from '@/room/partyControllerStorage'
import { GameChromeButton } from '@/shared/components/GameChromeButton'
import type { ActiveRoomSession } from '@/store'
import { DuelController } from './DuelController'

/**
 * 석양이 진다 — 1:1 반응속도 대결.
 *
 * 신호등이 초록으로 바뀌는 순간 먼저 뽑은 쪽이 쏜다. 1ms까지 같으면 TIE고, 3발 맞으면
 * 쓰러진다. 신호 전에 뽑으면 경고가 쌓이고 두 개가 차면 자기 발을 쏜다(규칙은 서버 소유).
 *
 * 이 화면은 판정을 하지 않는다. 뽑은 순간의 반응 시간만 서버에 올리고, 서버가 내려준
 * 상태를 무대(Arena)가 이해하는 "지금 이 화면"으로 번역한다. 진영 번호는 서버가 주지
 * 않으므로 여기서 <b>나를 항상 왼쪽</b>에 두고 좌우를 매긴다.
 */

interface DuelGameProps {
  onLeaveRequest: () => void
  roomId: string
  session: ActiveRoomSession
  snapshot: RoomSnapshot
}

export function DuelGame({ onLeaveRequest, roomId, session, snapshot }: DuelGameProps) {
  const state = snapshot.game as unknown as DuelState | undefined
  const {
    draw,
    flight,
    impact,
    impactDelay,
    myShot,
    permission,
    requestPermission,
    sendError,
    stageRef,
  } = useDuelGame({ roomId, session, state })

  if (!state) {
    return (
      <main className="grid h-svh place-items-center bg-duel-canvas text-white">
        결투장을 준비하고 있어요.
      </main>
    )
  }

  // 대시보드는 플레이어가 아니다 — 명단에 없으므로 "나 / 상대" 매핑이 성립하지 않는다.
  // 두 총잡이를 서버가 준 순서대로 세우고 닉네임으로 부른다.
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
  const swinging = permission === 'granted'

  // QR로 들어온 폰은 컨트롤러다 — 결투는 큰 화면에서 보고, 이 폰은 뽑는 일만 한다.
  // 판별은 205와 같은 기준(내 localStorage에 적힌 파티 방 코드)을 쓴다.
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
    <main
      className="relative flex h-svh w-full flex-col overflow-hidden bg-duel-canvas text-white select-none"
      ref={stageRef}
    >
      <Arena
        {...buildStage({
          impact,
          opponentId,
          opponentName: opponent?.nickname ?? '상대',
          state,
          you: session.you,
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
          <button
            className="min-h-11 rounded-full border border-duel-signal/50 bg-duel-signal/15 px-5 text-sm font-bold text-duel-accent-soft backdrop-blur-md transition-[scale] duration-150 focus-ring active:not-disabled:scale-[0.97]"
            onClick={(event) => {
              event.stopPropagation()
              void requestPermission()
            }}
            type="button"
          >
            휴대폰 휘두르기 켜기
          </button>
        )}
        {sendError && (
          <p className="m-0 rounded-full bg-black/55 px-3 py-1 text-sm text-red-300" role="alert">
            {sendError}
          </p>
        )}
      </section>
    </main>
  )
}
