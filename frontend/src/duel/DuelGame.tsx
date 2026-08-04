import { useCallback, useEffect, useRef, useState } from 'react'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import {
  buildClientMessage,
  DUEL_FOUL,
  type DuelState,
  type RoomSnapshot,
} from '@/realtime/wsEvents'
import { isRoomHost } from '@/room/api/roomApi'
import { useReturnToLobby } from '@/room/api/useGameApi'
import { Button } from '@/shared/components/Button'
import { useSwing } from '@/shared/useSwing'
import type { ActiveRoomSession } from '@/store'
import { Arena } from './Arena'
import { BULLET_MS, MAX_FOULS, MAX_HP, type ShotTarget, slots } from './duel'
import { Gunslinger, OUTFIT_LEFT, OUTFIT_RIGHT, type Outfit } from './Gunslinger'
import { buildStage } from './stage'

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

/**
 * 착탄까지 남은 시간. 목표를 맞히는 총알이 <b>내 것</b>이면 이미 날아간 만큼을 깎는다 —
 * 내 총알은 반응한 순간 떠났으므로 판정이 늦게 와도 착탄 시각은 그대로여야 한다.
 *
 * 판정에 들어서는 순간 한 번만 재고 그 뒤로는 붙잡아 둔다. 매 렌더 다시 재면 CSS
 * animation-delay가 계속 바뀌어 이미 재생 중인 연출이 앞으로 튄다.
 */
function useImpactDelay(
  state: DuelState | undefined,
  you: string,
  firedAt: { current: number | null },
) {
  const delay = useRef(BULLET_MS)
  const measuredRound = useRef(0)
  if (state?.phase === 'RESULT' && measuredRound.current !== state.round) {
    measuredRound.current = state.round
    const last = state.lastRound
    const mineLands = last?.shooterId === you || last?.foulId === you
    const flown = mineLands && firedAt.current !== null ? performance.now() - firedAt.current : 0
    delay.current = Math.max(0, Math.round(BULLET_MS - flown))
  }
  return delay
}

export function DuelGame({ onLeaveRequest, roomId, session, snapshot }: DuelGameProps) {
  const client = useRealtimeClient()
  const state = snapshot.game as unknown as DuelState | undefined
  const stateRef = useRef(state)
  const inputSeq = useRef(0)
  /**
   * 내가 신호를 본 시각. 반응 시간을 서버 도착 시각으로 재면 왕복 지연이 그대로
   * 핸디캡이 되므로, 각자 자기 화면 기준으로 재서 올린다(서버가 상한만 검증한다).
   */
  const signalSeenAt = useRef<number | null>(null)
  const [impact, setImpact] = useState(false)
  const [motionOn, setMotionOn] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  /**
   * 내가 이번 라운드에 쏜 총알 — 서버 응답을 기다리지 않고 반응한 순간에 총알을 내보내려고
   * 로컬로 기억한다. 라운드 번호를 함께 담는 이유는 다음 라운드가 열리는 순간 비교만으로
   * 자연히 풀리기 때문이다 — effect로 되돌리면 새 라운드의 첫 프레임에 총알이 한 번 스친다.
   */
  const [myShot, setMyShot] = useState<{ round: number; target: ShotTarget } | null>(null)
  /** 내 총알이 떠난 시각. 판정이 늦게 와도 착탄까지 남은 시간을 이만큼 깎는다. */
  const firedAt = useRef<number | null>(null)

  stateRef.current = state
  // 라운드는 WAITING → SIGNAL → RESULT 를 정확히 한 번씩 거치므로, 아래 두 타이밍은
  // 라운드 번호를 따로 볼 것 없이 국면 변화만으로 라운드마다 새로 잡힌다.
  const phase = state?.phase

  // 신호를 처음 그리는 렌더에서 기준 시각을 잡는다. effect까지 미루면 커밋과 effect 사이에
  // 들어온 아주 빠른 탭이 기준을 못 찾고 부정출발로 신고돼 버린다 — 억울한 경고다.
  if (phase === 'SIGNAL' && signalSeenAt.current === null) signalSeenAt.current = performance.now()
  if (phase !== 'SIGNAL' && signalSeenAt.current !== null) signalSeenAt.current = null

  const impactDelay = useImpactDelay(state, session.you, firedAt)

  // 총알이 닿는 순간 — 피격 자세와 체력 감소를 여기에 맞춘다. 서버 시각(lastRound.at)이
  // 아니라 로컬 타이머로 세는 이유는 두 기기의 시계가 맞다는 보장이 없기 때문이다.
  useEffect(() => {
    setImpact(false)
    if (phase !== 'RESULT') return
    const timeoutId = window.setTimeout(() => setImpact(true), impactDelay.current)
    return () => window.clearTimeout(timeoutId)
    // 남은 시간은 판정에 들어서는 렌더에서 이미 확정된다 — 이 국면 안에서는 다시 바뀌지 않는다.
  }, [phase, impactDelay.current])

  const draw = useCallback(() => {
    const current = stateRef.current
    if (!current) return
    if (current.phase !== 'WAITING' && current.phase !== 'SIGNAL') return
    // 한 라운드에 한 발이다. 이미 뽑았으면 상대를 기다린다.
    if (current.reactions[session.you] !== undefined) return
    const early = current.phase === 'WAITING' || signalSeenAt.current === null
    const reactionMs = early
      ? DUEL_FOUL
      : Math.round(performance.now() - (signalSeenAt.current ?? 0))
    // 총알은 지금 떠난다. 판정은 서버가 하지만 손맛까지 왕복 지연을 기다릴 이유는 없다.
    // 신호를 못 본 채 당겼으면 총알은 상대가 아니라 자기 발밑에 박힌다.
    firedAt.current = performance.now()
    setMyShot({ round: current.round, target: early ? 'ground' : 'opponent' })
    try {
      client.send(
        buildClientMessage(
          'game.duel.draw',
          { inputSeq: ++inputSeq.current, reactionMs },
          { roomId },
        ),
      )
      setSendError(null)
    } catch {
      // 못 보냈으면 쏘지 않은 것이다 — 되돌려 다시 뽑을 수 있게 한다.
      firedAt.current = null
      setMyShot(null)
      setSendError('연결을 확인한 뒤 다시 뽑아 주세요.')
    }
  }, [client, roomId, session.you])

  const { permission, requestPermission } = useSwing({
    enabled: motionOn,
    onSwing: draw,
    threshold: 15,
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== 'Space') return
      event.preventDefault()
      draw()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draw])

  if (!state) {
    return (
      <main className="grid h-svh place-items-center bg-[#0b0409] text-white">
        결투장을 준비하고 있어요.
      </main>
    )
  }

  const opponentId = state.playerOrder.find((playerId) => playerId !== session.you) ?? ''
  const opponent = snapshot.players.find((player) => player.playerId === opponentId)
  const swinging = permission === 'granted'

  return (
    <main className="relative flex h-svh w-full flex-col overflow-hidden bg-[#0b0409] text-white select-none">
      <Arena
        {...buildStage({
          impact,
          opponentId,
          opponentName: opponent?.nickname ?? '상대',
          state,
          you: session.you,
          youShot: myShot?.round === state.round ? myShot.target : null,
        })}
        actLabel={swinging ? '휘둘러!' : 'TAP'}
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
            draw()
          }}
          type="button"
        />
      </Arena>

      <button
        className="absolute top-[max(0.75rem,env(safe-area-inset-top))] left-3 z-20 min-h-11 rounded-full border border-white/20 bg-black/45 px-4 text-sm backdrop-blur-md"
        onClick={(event) => {
          event.stopPropagation()
          onLeaveRequest()
        }}
        type="button"
      >
        나가기
      </button>

      <section className="absolute inset-x-0 bottom-0 z-20 grid justify-items-center gap-2 px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {permission === 'unknown' && (
          <button
            className="min-h-11 rounded-full border border-[#f59e0b]/50 bg-[#f59e0b]/15 px-5 text-sm font-bold text-[#ffd9a0] backdrop-blur-md"
            onClick={(event) => {
              event.stopPropagation()
              setMotionOn(true)
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

/** 결투가 끝났다 — 살아남은 쪽이 총을 내려놓고 서 있다. */
export function DuelResult({ onLeaveRequest, session, snapshot }: Omit<DuelGameProps, 'roomId'>) {
  const returnToLobby = useReturnToLobby()
  const state = snapshot.game as unknown as DuelState | undefined
  const opponent = snapshot.players.find((player) => player.playerId !== session.you)
  const myHp = state?.hp[session.you] ?? 0
  const opponentHp = opponent ? (state?.hp[opponent.playerId] ?? 0) : 0
  // 쓰러진 사람이 진 사람이다. 남은 총알로 따지지 않는 이유는 부정출발 실격이
  // 총알을 남긴 채로 지기 때문이다(이탈도 마찬가지다).
  const fallen = state?.lastRound?.koId
  const won = fallen ? fallen !== session.you : myHp > opponentHp
  const host = isRoomHost(snapshot, session.you)

  return (
    <main
      className="relative mx-auto flex h-svh w-full max-w-2xl flex-col items-center justify-center gap-5 overflow-hidden px-gutter text-white"
      style={{ background: 'linear-gradient(#170817, #4a1622 58%, #0d0406)' }}
    >
      <div className="flex items-end" style={{ height: 150 }}>
        <Gunslinger
          flip={!won}
          height={150}
          outfit={won ? OUTFIT_LEFT : OUTFIT_RIGHT}
          pose="ready"
        />
      </div>

      <p
        className="m-0 font-mono text-[11px] tracking-[0.3em] uppercase"
        style={{ color: '#ffcf8a' }}
      >
        Last man standing
      </p>
      <h1 className="m-0 text-5xl font-black" style={{ color: won ? '#86efac' : '#fca5a5' }}>
        {won ? '살아남았다' : '쓰러졌다'}
      </h1>

      <section className="flex items-center gap-6 rounded-3xl border border-white/15 bg-white/8 px-8 py-6 backdrop-blur-md">
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
