import type { ReactNode, RefObject } from 'react'
import type { DuelState, RoomSnapshot } from '@/realtime/wsEvents'
import { isRoomHost } from '@/room/api/roomApi'
import { useReturnToLobby } from '@/room/api/useGameApi'
import { isPartyRoom } from '@/room/partyControllerStorage'
import { Button } from '@/shared/components/Button'
import { GameChromeButton } from '@/shared/components/GameChromeButton'
import type { ActiveRoomSession } from '@/store'
import { Arena } from './Arena'
import { DuelController } from './DuelController'
import { MAX_FOULS, MAX_HP, slots } from './duel'
import { Gunslinger, OUTFIT_LEFT, OUTFIT_RIGHT, type Outfit } from './Gunslinger'
import { buildStage } from './stage'
import { useDuelGame } from './useDuelGame'

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
        impactDelayMs={impactDelay.current}
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
        impactDelayMs={impactDelay.current}
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

/**
 * 파티 모드 큰 화면 — 관전이다.
 *
 * 조작이 없다: 뽑는 것은 폰(컨트롤러)이 하고 이 화면은 결투를 보여 준다. 두 총잡이를 서버가
 * 준 순서(playerOrder)대로 세우고 닉네임으로 부른다 — 대시보드는 명단에 없으므로 "나"라고
 * 부를 사람이 없다. 총알도 로컬 신호가 없어 판정과 함께 들어온다(누른 사람이 없으니 맞다).
 */
function DuelDashboard({
  flight,
  impact,
  impactDelayMs,
  onClose,
  snapshot,
  stageRef,
  state,
}: {
  flight: number
  impact: boolean
  impactDelayMs: number
  onClose: () => void
  snapshot: RoomSnapshot
  stageRef: RefObject<HTMLElement | null>
  state: DuelState
}) {
  const [first, second] = state.playerOrder
  const nameOf = (playerId: string | undefined) =>
    snapshot.players.find((player) => player.playerId === playerId)?.nickname ?? '?'

  return (
    <main
      className="relative flex h-svh w-full flex-col overflow-hidden bg-duel-canvas text-white select-none"
      ref={stageRef}
    >
      <Arena
        {...buildStage({
          impact,
          opponentId: second ?? '',
          opponentName: nameOf(second),
          state,
          you: first ?? '',
          youName: nameOf(first),
          // 관전 화면은 방아쇠를 당기지 않는다 — 두 총알 모두 판정으로 알게 된다.
          youShot: null,
        })}
        actLabel="DRAW!"
        flightMs={flight}
        fxKey={state.round}
        hint="폰에서 뽑습니다"
        impactDelayMs={impactDelayMs}
        maxFouls={MAX_FOULS}
        maxHp={MAX_HP}
        round={state.round}
      />

      <GameChromeButton
        className="absolute top-[max(0.75rem,env(safe-area-inset-top))] left-3 z-20"
        tone="overlay"
        onClick={onClose}
        type="button"
      >
        방 닫기
      </GameChromeButton>
    </main>
  )
}

/** 결투가 끝났다 — 살아남은 쪽이 총을 내려놓고 서 있다. */
export function DuelResult({ onLeaveRequest, session, snapshot }: Omit<DuelGameProps, 'roomId'>) {
  const returnToLobby = useReturnToLobby()
  const state = snapshot.game as unknown as DuelState | undefined
  // 대시보드는 승패의 당사자가 아니다 — "살아남았다"라고 말할 주체가 없다.
  if (session.membershipRole === 'dashboard') {
    return <DuelDashboardResult onClose={onLeaveRequest} snapshot={snapshot} state={state} />
  }
  const opponent = snapshot.players.find((player) => player.playerId !== session.you)
  const myHp = state?.hp[session.you] ?? 0
  const opponentHp = opponent ? (state?.hp[opponent.playerId] ?? 0) : 0
  // 쓰러진 사람이 진 사람이다. 남은 총알로 따지지 않는 이유는 부정출발 실격이
  // 총알을 남긴 채로 지기 때문이다(이탈도 마찬가지다).
  const fallen = state?.lastRound?.koId
  const won = fallen ? fallen !== session.you : myHp > opponentHp
  const host = isRoomHost(snapshot, session.you)

  return (
    <ResultBackdrop>
      <div className="flex items-end" style={{ height: 'clamp(150px, 22vh, 260px)' }}>
        <Gunslinger
          flip={!won}
          height="100%"
          outfit={won ? OUTFIT_LEFT : OUTFIT_RIGHT}
          pose="ready"
        />
      </div>

      <p
        className="m-0 font-mono text-2xs tracking-[0.3em] uppercase"
        style={{ color: 'var(--ds-duel-accent)' }}
      >
        Last man standing
      </p>
      <h1
        className="m-0 font-black"
        style={{
          color: won ? 'var(--ds-duel-positive)' : 'var(--ds-duel-danger)',
          fontSize: 'clamp(2.25rem, 6vw, 4.5rem)',
        }}
      >
        {won ? '살아남았다' : '쓰러졌다'}
      </h1>

      <section className="flex items-center gap-6 rounded-sheet border border-white/15 bg-white/8 px-8 py-6 backdrop-blur-md">
        <Ammo hp={myHp} name="나" outfit={OUTFIT_LEFT} />
        <span className="text-2xl text-white/35">:</span>
        <Ammo hp={opponentHp} name={opponent?.nickname ?? '상대'} outfit={OUTFIT_RIGHT} />
      </section>

      <div className="grid w-full max-w-sm gap-3">
        {host ? (
          <Button
            loading={returnToLobby.isLoading}
            onClick={() => void returnToLobby.execute()}
            size="lg"
          >
            대기실로 돌아가기
          </Button>
        ) : (
          <p className="m-0 text-center text-sm text-white/60">
            호스트가 재대결을 준비하고 있어요.
          </p>
        )}
        <Button onClick={onLeaveRequest} size="lg" variant="secondary">
          방 나가기
        </Button>
      </div>
    </ResultBackdrop>
  )
}

/**
 * 파티 모드 큰 화면의 결과 — 누가 이겼는지 이름으로 말한다.
 *
 * 조작은 폰이 한다. 여기에는 "대기실로 돌아가기"를 두지 않는다 — 그건 방장(처음 들어온
 * 컨트롤러) 몫이고, TV 앞에서 누를 마우스를 기대하지 않는 것과 같은 이유다.
 */
function DuelDashboardResult({
  onClose,
  snapshot,
  state,
}: {
  onClose: () => void
  snapshot: RoomSnapshot
  state: DuelState | undefined
}) {
  const nameOf = (playerId: string | undefined) =>
    snapshot.players.find((player) => player.playerId === playerId)?.nickname ?? '?'
  const [first, second] = state?.playerOrder ?? []
  const fallen = state?.lastRound?.koId
  const survivor = fallen === first ? second : fallen === second ? first : undefined

  return (
    <ResultBackdrop>
      <div className="flex items-end" style={{ height: 'clamp(150px, 22vh, 260px)' }}>
        <Gunslinger
          flip={survivor === second}
          height="100%"
          outfit={survivor === second ? OUTFIT_RIGHT : OUTFIT_LEFT}
          pose="ready"
        />
      </div>

      <p
        className="m-0 font-mono text-2xs tracking-[0.3em] uppercase"
        style={{ color: 'var(--ds-duel-accent)' }}
      >
        Last man standing
      </p>
      <h1
        className="m-0 font-black"
        style={{ color: 'var(--ds-duel-positive)', fontSize: 'clamp(2.25rem, 6vw, 4.5rem)' }}
      >
        {survivor ? `${nameOf(survivor)} 승리` : '무승부'}
      </h1>

      <section className="flex items-center gap-6 rounded-sheet border border-white/15 bg-white/8 px-8 py-6 backdrop-blur-md">
        <Ammo hp={state?.hp[first ?? ''] ?? 0} name={nameOf(first)} outfit={OUTFIT_LEFT} />
        <span className="text-2xl text-white/35">:</span>
        <Ammo hp={state?.hp[second ?? ''] ?? 0} name={nameOf(second)} outfit={OUTFIT_RIGHT} />
      </section>

      <p className="m-0 text-center text-sm text-white/60">
        방장이 폰에서 재대결을 시작할 수 있어요.
      </p>
      <Button onClick={onClose} size="lg" variant="secondary">
        방 닫기
      </Button>
    </ResultBackdrop>
  )
}

/**
 * 결과 화면의 바탕.
 *
 * 석양 그라디언트를 <b>화면 전체</b>에 칠하고, 폭 제한은 안쪽 내용에만 준다. 예전에는 main
 * 하나에 `max-w-2xl`과 배경을 같이 걸어서, 큰 화면(TV·모니터)에서 가운데 672px만 석양이고
 * 양옆이 검게 남아 화면이 잘린 것처럼 보였다.
 */
function ResultBackdrop({ children }: { children: ReactNode }) {
  return (
    <main
      className="relative flex h-svh w-full flex-col items-center justify-center overflow-hidden text-white"
      style={{ background: 'linear-gradient(#170817, #4a1622 58%, #0d0406)' }}
    >
      <div className="flex w-full max-w-2xl flex-col items-center justify-center gap-5 px-gutter">
        {children}
      </div>
    </main>
  )
}

/** 남은 탄약으로 읽는 스코어. */
function Ammo({ hp, name, outfit }: { hp: number; name: string; outfit: Outfit }) {
  return (
    <div className="grid justify-items-center gap-1.5">
      <span className="max-w-28 truncate text-xs font-black" style={{ color: outfit.scarf }}>
        {name}
      </span>
      <div className="flex gap-1">
        {slots('ammo', MAX_HP, hp).map((slot) => (
          <span
            className="block"
            key={slot.id}
            style={{
              background: slot.filled
                ? 'linear-gradient(#ffe9a8 0%, #d9a53c 34%, #8a5f18 100%)'
                : 'rgb(255 255 255 / 8%)',
              border: slot.filled ? '1px solid #6d4a11' : '1px solid rgb(255 255 255 / 16%)',
              borderRadius: '2px 2px 3px 3px',
              height: 17,
              width: 9,
            }}
          />
        ))}
      </div>
    </div>
  )
}
