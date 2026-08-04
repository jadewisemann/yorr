import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import { buildClientMessage, type PingPongState, type RoomSnapshot } from '@/realtime/wsEvents'
import { isRoomHost } from '@/room/api/roomApi'
import { useReturnToLobby } from '@/room/api/useGameApi'
import { Button } from '@/shared/components/Button'
import { useSwing } from '@/shared/useSwing'
import type { ActiveRoomSession } from '@/store'
import { type Fault, flightProgress } from './court'
import { feedbackTextClass, sharedEventLabel } from './feedback'
import { ComboBadge, PingPongController } from './PingPongController'
import { type PlayerTracking, trackIncomingBall } from './playerTracking'
import { createScene, type FrameState, type PingPongScene } from './scene3d'

interface PingPongGameProps {
  onLeaveRequest: () => void
  roomId: string
  session: ActiveRoomSession
  snapshot: RoomSnapshot
}

export function PingPongGame({ onLeaveRequest, roomId, session, snapshot }: PingPongGameProps) {
  const client = useRealtimeClient()
  const dashboard = session.membershipRole === 'dashboard'
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<PingPongScene | null>(null)
  const trackingRef = useRef({ p1X: 0.5, p2X: 0.5 })
  const state = snapshot.game as unknown as PingPongState | undefined
  const stateRef = useRef(state)
  const viewerRef = useRef<1 | 2>(1)
  const inputSeq = useRef(0)
  const [clock, setClock] = useState(Date.now())
  const [sendError, setSendError] = useState<string | null>(null)

  stateRef.current = state
  viewerRef.current = viewerFor(state, session.you)

  const swing = useCallback(() => {
    if (dashboard || !canSwing(stateRef.current)) return
    try {
      client.send(
        buildClientMessage(
          'game.ping_pong.swing',
          { inputSeq: ++inputSeq.current, clientTs: Date.now() },
          { roomId },
        ),
      )
      setSendError(null)
    } catch {
      setSendError('연결을 확인한 뒤 다시 스윙해 주세요.')
    }
  }, [client, dashboard, roomId])

  const ready = useCallback(() => {
    if (dashboard || stateRef.current?.phase !== 'PREPARING') return
    try {
      client.send(buildClientMessage('game.ping_pong.ready', {}, { roomId }))
      setSendError(null)
    } catch {
      setSendError('연결을 확인한 뒤 다시 준비해 주세요.')
    }
  }, [client, dashboard, roomId])

  const { permission, requestPermission } = useSwing({
    onSwing: swing,
    enabled: canControl(dashboard, state),
  })

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 100)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== 'Space') return
      event.preventDefault()
      swing()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [swing])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scene = createScene(canvas)
    sceneRef.current = scene
    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      scene.resize(bounds.width, bounds.height, Math.min(window.devicePixelRatio || 1, 2))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    let raf = 0
    const frame = () => {
      const current = stateRef.current
      if (current)
        renderSceneFrame(
          scene,
          current,
          viewerRef.current,
          Date.now(),
          trackingRef.current,
          dashboard,
        )
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      scene.dispose()
      sceneRef.current = null
    }
  }, [dashboard])

  if (!state) {
    return (
      <main className="grid h-svh place-items-center bg-[#070b12] text-white">
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

  return (
    <PingPongController
      clock={clock}
      error={sendError}
      nickname={session.nickname}
      onLeave={onLeaveRequest}
      onReady={ready}
      onSwing={swing}
      permission={permission}
      playerId={session.you}
      requestPermission={requestPermission}
      snapshot={snapshot}
      state={state}
    />
  )
}

function PingPongDashboard({
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
  const firstPlayerId = state.playerOrder[0] ?? ''
  const secondPlayerId = state.playerOrder[1] ?? ''
  const firstPlayer = snapshot.players.find((player) => player.playerId === firstPlayerId)
  const secondPlayer = snapshot.players.find((player) => player.playerId === secondPlayerId)
  const countdown =
    state.phase === 'COUNTDOWN' ? Math.max(1, Math.ceil((state.nextActionAt - clock) / 1_000)) : 0
  const event = state.lastEvent
  const eventAge = event ? clock - event.at : Number.POSITIVE_INFINITY
  const actor = snapshot.players.find((player) => player.playerId === event?.playerId)
  const label = event ? sharedEventLabel(event.type, actor?.nickname ?? '플레이어') : null

  return (
    <main className="relative h-svh w-full overflow-hidden bg-[#070b12] text-white">
      <canvas
        aria-label="파티 모드 3D 탁구 코트"
        className="absolute inset-0 size-full"
        ref={canvasRef}
      />
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-4">
        <Score
          name={firstPlayer?.nickname ?? 'P1'}
          score={state.scores[firstPlayerId] ?? 0}
          tone="blue"
        />
        <div className="mt-1 rounded-full border border-white/15 bg-black/35 px-3 py-1.5 text-center font-mono text-xs tracking-[0.14em] backdrop-blur-md">
          PARTY · RALLY {state.rally}
        </div>
        <Score
          name={secondPlayer?.nickname ?? 'P2'}
          score={state.scores[secondPlayerId] ?? 0}
          tone="red"
        />
      </header>
      <button
        className="absolute top-20 left-4 z-20 min-h-11 rounded-full border border-white/20 bg-black/45 px-4 text-sm backdrop-blur-md"
        onClick={onClose}
        type="button"
      >
        방 닫기
      </button>
      {countdown > 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <div className="grid size-32 place-items-center rounded-full border border-white/20 bg-black/45 font-mono text-7xl font-black backdrop-blur-md">
            {countdown}
          </div>
        </div>
      )}
      {state.phase === 'PREPARING' && (
        <PingPongPreparationDashboard snapshot={snapshot} state={state} />
      )}
      {label && event && eventAge < 900 && (
        <div
          className={`animate-pp-feedback-pop pointer-events-none absolute inset-x-0 top-[17%] z-10 text-center text-4xl font-black drop-shadow-[0_3px_12px_rgb(0_0_0_/_80%)] ${feedbackTextClass(event.type)}`}
        >
          {label}
        </div>
      )}
      {event?.type === 'SMASH' && eventAge < 220 && (
        <div className="animate-pp-smash-flash pointer-events-none absolute inset-0 z-[5] bg-[radial-gradient(circle_at_50%_55%,rgb(255_150_110_/_45%),transparent_70%)]" />
      )}
      {state.rally > 0 && <ComboBadge count={state.rally} placement="dashboard" />}
      <p className="pointer-events-none absolute inset-x-0 bottom-5 z-20 m-0 text-center text-sm text-white/55">
        두 플레이어가 각자 휴대폰으로 조작하고 있어요.
      </p>
    </main>
  )
}

function PingPongPreparationDashboard({
  snapshot,
  state,
}: {
  snapshot: RoomSnapshot
  state: PingPongState
}) {
  const latestPractice =
    state.lastEvent?.type === 'PRACTICE'
      ? snapshot.players.find((player) => player.playerId === state.lastEvent?.playerId)
      : null

  return (
    <section className="absolute inset-0 z-10 grid place-items-center bg-black/45 px-5 backdrop-blur-[2px]">
      <div className="grid w-full max-w-xl gap-6 rounded-[2rem] border border-white/15 bg-[#0b111b]/95 p-7 text-center shadow-2xl">
        <div>
          <p className="m-0 font-mono text-xs tracking-[0.2em] text-[#73bfff]">WARM-UP</p>
          <h1 className="mt-2 mb-0 text-4xl font-black">휴대폰으로 연습 공을 쳐보세요</h1>
          <p className="mt-2 mb-0 text-white/55">두 명 모두 준비 완료하면 경기가 시작됩니다.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {state.playerOrder.map((playerId, index) => {
            const player = snapshot.players.find((candidate) => candidate.playerId === playerId)
            const ready = state.readyPlayerIds.includes(playerId)
            return (
              <div
                className={`rounded-2xl border px-4 py-4 ${ready ? 'border-[#49e08a]/45 bg-[#49e08a]/12' : 'border-white/12 bg-white/6'}`}
                key={playerId}
              >
                <span className="block truncate text-lg font-black">
                  {player?.nickname ?? `P${index + 1}`}
                </span>
                <span className={ready ? 'text-[#8dffc0]' : 'text-white/45'}>
                  {ready ? '준비 완료' : '연습 중'}
                </span>
              </div>
            )
          })}
        </div>
        <p className="m-0 min-h-6 text-lg font-bold text-[#ffd24a]" role="status">
          {latestPractice
            ? `${latestPractice.nickname} 연습 스윙 감지!`
            : '휴대폰에서 공을 한 번 쳐보세요'}
        </p>
      </div>
    </section>
  )
}

export function PingPongResult({
  onLeaveRequest,
  session,
  snapshot,
}: Omit<PingPongGameProps, 'roomId'>) {
  const returnToLobby = useReturnToLobby()
  const state = snapshot.game as unknown as PingPongState | undefined
  const dashboard = session.membershipRole === 'dashboard'

  if (dashboard) {
    return <PingPongDashboardResult onClose={onLeaveRequest} snapshot={snapshot} state={state} />
  }

  const opponent = snapshot.players.find((player) => player.playerId !== session.you)
  const myScore = state?.scores[session.you] ?? 0
  const opponentScore = opponent ? (state?.scores[opponent.playerId] ?? 0) : 0
  const won = myScore > opponentScore
  const host = isRoomHost(snapshot, session.you)

  return (
    <main className="relative mx-auto flex h-svh w-full max-w-2xl flex-col items-center justify-center gap-7 overflow-hidden bg-[#070b12] px-gutter text-white">
      <div className="absolute inset-0 [background:radial-gradient(circle_at_50%_30%,rgb(43_143_224_/_20%),transparent_45%)]" />
      <p className="relative m-0 font-mono text-xs tracking-[0.22em] text-white/55">
        MATCH FINISHED
      </p>
      <h1 className="relative m-0 text-5xl font-black">{won ? '승리!' : '좋은 경기였어요'}</h1>
      <section className="relative flex items-center gap-6 rounded-3xl border border-white/15 bg-white/8 px-8 py-7 backdrop-blur-md">
        <Score name="나" score={myScore} tone="blue" large />
        <span className="text-2xl text-white/35">:</span>
        <Score name={opponent?.nickname ?? '상대'} score={opponentScore} tone="red" large />
      </section>
      <div className="relative grid w-full max-w-sm gap-3">
        {host ? (
          <Button
            size="lg"
            loading={returnToLobby.isLoading}
            onClick={() => void returnToLobby.execute()}
          >
            대기실로 돌아가기
          </Button>
        ) : (
          <p className="m-0 text-center text-sm text-white/60">
            호스트가 재대결을 준비하고 있어요.
          </p>
        )}
        <Button size="lg" onClick={onLeaveRequest} variant="secondary">
          방 나가기
        </Button>
      </div>
    </main>
  )
}

function PingPongDashboardResult({
  onClose,
  snapshot,
  state,
}: {
  onClose: () => void
  snapshot: RoomSnapshot
  state: PingPongState | undefined
}) {
  const firstPlayerId = state?.playerOrder[0] ?? ''
  const secondPlayerId = state?.playerOrder[1] ?? ''
  const firstPlayer = snapshot.players.find((player) => player.playerId === firstPlayerId)
  const secondPlayer = snapshot.players.find((player) => player.playerId === secondPlayerId)

  return (
    <main className="relative mx-auto flex h-svh w-full max-w-2xl flex-col items-center justify-center gap-7 overflow-hidden bg-[#070b12] px-gutter text-white">
      <p className="m-0 font-mono text-xs tracking-[0.22em] text-white/55">MATCH FINISHED</p>
      <h1 className="m-0 text-5xl font-black">경기 종료</h1>
      <section className="flex items-center gap-6 rounded-3xl border border-white/15 bg-white/8 px-8 py-7">
        <Score
          name={firstPlayer?.nickname ?? 'P1'}
          score={state?.scores[firstPlayerId] ?? 0}
          tone="blue"
          large
        />
        <span className="text-2xl text-white/35">:</span>
        <Score
          name={secondPlayer?.nickname ?? 'P2'}
          score={state?.scores[secondPlayerId] ?? 0}
          tone="red"
          large
        />
      </section>
      <p className="m-0 text-center text-sm text-white/60">
        방장이 폰에서 재대결을 준비할 수 있어요.
      </p>
      <Button size="lg" onClick={onClose} variant="secondary">
        방 닫기
      </Button>
    </main>
  )
}

function Score({
  name,
  score,
  tone,
  large = false,
}: {
  name: string
  score: number
  tone: 'blue' | 'red'
  large?: boolean
}) {
  return (
    <div
      className={`grid min-w-20 text-center ${tone === 'blue' ? 'text-[#73bfff]' : 'text-[#ff8b7c]'}`}
    >
      <span className="max-w-28 truncate text-xs font-bold text-white/65">{name}</span>
      <strong className={`font-mono leading-none ${large ? 'text-7xl' : 'text-4xl'}`}>
        {score}
      </strong>
    </div>
  )
}

function currentBall(state: PingPongState, now: number) {
  const source = state.ball
  const elapsed = state.phase === 'PLAYING' ? Math.max(0, now - source.launchedAt) / 1_000 : 0
  const pos = source.pos + source.direction * source.speed * elapsed
  const progress = Math.max(0, Math.min(1, source.direction > 0 ? pos : 1 - pos))
  return {
    ...source,
    pos,
    x: source.x0 + (source.x1 - source.x0) * progress,
    faultFrom: source.fault ? source.faultFrom : flightProgress(pos, source.direction),
  }
}

function viewerFor(state: PingPongState | undefined, playerId: string): 1 | 2 {
  return state?.playerOrder.indexOf(playerId) === 1 ? 2 : 1
}

function canControl(dashboard: boolean, state: PingPongState | undefined) {
  return !dashboard && canSwing(state)
}

function canSwing(state: PingPongState | undefined) {
  return state?.phase === 'PREPARING' || state?.phase === 'PLAYING'
}

function renderSceneFrame(
  scene: PingPongScene,
  state: PingPongState,
  viewer: 1 | 2,
  now: number,
  tracking: PlayerTracking,
  split: boolean,
) {
  const rendered = createFrameState(state, viewer, now, tracking, split)
  scene.update(rendered)
  scene.render(rendered)
}

function createFrameState(
  state: PingPongState,
  viewer: 1 | 2,
  now: number,
  tracking: PlayerTracking,
  split: boolean,
): FrameState {
  const ball = currentBall(state, now)
  trackIncomingBall(tracking, ball.direction, ball.x)
  const eventAge = state.lastEvent ? now - state.lastEvent.at : Number.POSITIVE_INFINITY
  const swingAmount = eventAge < 260 ? 1 - eventAge / 260 : 0
  const eventPlayer = state.lastEvent?.playerId
  const fault = ball.fault?.toLowerCase() as Fault | undefined
  const falling = state.phase === 'COUNTDOWN' && ball.fault && state.lastEvent
  return {
    split,
    viewer,
    playing: state.phase === 'PLAYING',
    ballPos: ball.pos,
    ballDir: ball.direction,
    ballX: ball.x,
    ballSmash: ball.smash,
    ballHit: false,
    ballFault: fault ?? null,
    ballFaultFrom: ball.faultFrom,
    ballFall: falling ? Math.min(1.2, eventAge / 1_000) : 0,
    p1X: tracking.p1X,
    p2X: tracking.p2X,
    p1Swing: eventPlayer === state.playerOrder[0] ? swingAmount : 0,
    p2Swing: eventPlayer === state.playerOrder[1] ? swingAmount : 0,
    shake: state.lastEvent?.type === 'SMASH' && eventAge < 190 ? 1 - eventAge / 190 : 0,
  }
}
