import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import { buildClientMessage, type PingPongState, type RoomSnapshot } from '@/realtime/wsEvents'
import { isRoomHost } from '@/room/api/roomApi'
import { useReturnToLobby } from '@/room/api/useGameApi'
import { Button } from '@/shared/components/Button'
import { useMediaQuery } from '@/shared/useMediaQuery'
import { useSwing } from '@/shared/useSwing'
import type { ActiveRoomSession } from '@/store'
import { type Fault, flightOf, flightProgress } from './court'
import {
  feedbackTextClass,
  pingPongSituation,
  sharedEventLabel,
  sharedSituationLabel,
} from './feedback'
import { ComboBadge, PingPongController, readyButtonLabel } from './PingPongController'
import { type PlayerTracking, trackIncomingBall } from './playerTracking'
import { createScene, type FrameState, type PingPongScene } from './scene3d'
import { playRacketHit, playTableHit } from './sounds'

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
  const client = useRealtimeClient()
  const dashboard = session.membershipRole === 'dashboard'
  const wideMouse = useMediaQuery(DESKTOP_PLAYER)
  const desktop = !dashboard && wideMouse
  // 3D 코트를 띄우는 화면인가 = canvas가 마운트되는가.
  const court = dashboard || desktop
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<PingPongScene | null>(null)
  const trackingRef = useRef({ p1X: 0.5, p2X: 0.5 })
  const state = snapshot.game as unknown as PingPongState | undefined
  const stateRef = useRef(state)
  const viewerRef = useRef<1 | 2>(1)
  const inputSeq = useRef(0)
  const soundedEvent = useRef(0)
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
    const event = state?.lastEvent
    if (!event || event.id === soundedEvent.current) return
    soundedEvent.current = event.id
    playRacketHit(event.type)
  }, [state?.lastEvent])

  useEffect(() => {
    const ball = state?.ball
    if (!ball || ball.fault || state?.phase !== 'PLAYING') return
    const elapsed = Math.max(0, Date.now() - ball.launchedAt) / 1_000
    const currentPos = ball.pos + ball.direction * ball.speed * elapsed
    const start = flightProgress(currentPos, ball.direction)
    const delay = ((flightOf(ball.smash).bounceAt - start) / ball.speed) * 1_000
    if (delay < 0) return
    const timeoutId = window.setTimeout(playTableHit, delay)
    return () => window.clearTimeout(timeoutId)
  }, [state?.ball, state?.phase])

  // court를 보는 이유: canvas는 코트 화면에서만 마운트된다. 창을 좁혀 폰 컨트롤러로 바뀌면
  // canvas가 사라지는데, 그때 이 effect가 다시 돌지 않으면 씬이 떨어져 나간 canvas에
  // 계속 프레임을 그린다. dashboard는 split 화면(둘 다 비추기) 여부다.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!court || !canvas) return
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
  }, [court, dashboard])

  if (!state) {
    return (
      <main className="grid h-svh place-items-center bg-pingpong-canvas text-white">
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

function dashboardSituationLabel(
  state: PingPongState,
  firstPlayerId: string,
  secondPlayerId: string,
  firstName: string,
  secondName: string,
) {
  if (state.phase !== 'COUNTDOWN') return null
  return sharedSituationLabel(
    pingPongSituation(state.scores[firstPlayerId] ?? 0, state.scores[secondPlayerId] ?? 0),
    firstName,
    secondName,
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
  return (
    <main className="relative h-svh w-full overflow-hidden bg-pingpong-canvas text-white">
      <canvas
        aria-label="파티 모드 3D 탁구 코트"
        className="absolute inset-0 size-full"
        ref={canvasRef}
      />
      <button
        className="absolute top-20 left-4 z-20 min-h-11 rounded-full border border-white/20 bg-black/45 px-4 text-sm backdrop-blur-md"
        onClick={onClose}
        type="button"
      >
        방 닫기
      </button>
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
function PingPongDesktopPlayer({
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
    <main className="relative h-svh w-full overflow-hidden bg-pingpong-canvas text-white">
      <canvas aria-label="3D 탁구 코트" className="absolute inset-0 size-full" ref={canvasRef} />
      {/* 코트 전체가 스윙 버튼이다 — 캔버스 위에 투명하게 덮으므로 어디를 클릭해도 받아친다.
          아래 버튼·오버레이는 z-10 이상이라 이 판에 먹히지 않는다. */}
      <button
        aria-label="화면을 클릭해 스윙"
        className="absolute inset-0 size-full cursor-pointer"
        onClick={onSwing}
        type="button"
      />
      <button
        className="absolute top-20 left-4 z-20 min-h-11 rounded-full border border-white/20 bg-black/45 px-4 text-sm backdrop-blur-md"
        onClick={onLeave}
        type="button"
      >
        나가기
      </button>
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
      <p className="pointer-events-none absolute inset-x-0 bottom-5 z-20 m-0 text-center text-sm text-white/55">
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

function DesktopReadyButton({
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

/**
 * 코트 위에 겹치는 HUD — 점수·랠리 배지·카운트다운·피드백. 대시보드와 데스크톱 플레이어가
 * 같은 코트를 보므로 같은 HUD를 쓴다.
 *
 * `preparation`을 자식으로 받는 이유는 <b>쌓이는 순서</b> 때문이다. 워밍업 카드와 피드백은
 * 둘 다 z-10이라 뒤에 오는 쪽이 위에 그려진다 — 카드 위에 피드백이 떠야 워밍업 중에도
 * 연습 스윙 라벨이 읽힌다. 형제로 두면 호출부 순서에 따라 이 관계가 뒤집힌다.
 */
function CourtOverlay({
  badge,
  clock,
  preparation,
  snapshot,
  state,
}: {
  badge: string
  clock: number
  preparation?: ReactNode
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
  const situationLabel = dashboardSituationLabel(
    state,
    firstPlayerId,
    secondPlayerId,
    firstPlayer?.nickname ?? 'P1',
    secondPlayer?.nickname ?? 'P2',
  )

  return (
    <>
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-4">
        <Score
          name={firstPlayer?.nickname ?? 'P1'}
          score={state.scores[firstPlayerId] ?? 0}
          tag="P1"
          tone="blue"
        />
        <div className="mt-1 rounded-full border border-white/15 bg-black/35 px-3 py-1.5 text-center font-mono text-xs tracking-[0.14em] backdrop-blur-md">
          {badge}
        </div>
        <Score
          name={secondPlayer?.nickname ?? 'P2'}
          score={state.scores[secondPlayerId] ?? 0}
          tag="P2"
          tone="red"
        />
      </header>
      {countdown > 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <div className="grid size-32 place-items-center rounded-full border border-white/20 bg-black/45 font-mono text-7xl font-black backdrop-blur-md">
            {countdown}
          </div>
        </div>
      )}
      {preparation}
      <DashboardFeedback
        event={event}
        eventAge={eventAge}
        eventLabel={label}
        rally={state.rally}
        situationLabel={situationLabel}
      />
      {event?.type === 'SMASH' && eventAge < 220 && (
        <div className="animate-pp-smash-flash pointer-events-none absolute inset-0 z-[5] bg-[radial-gradient(circle_at_50%_55%,rgb(255_150_110_/_45%),transparent_70%)]" />
      )}
    </>
  )
}

function DashboardFeedback({
  event,
  eventAge,
  eventLabel,
  rally,
  situationLabel,
}: {
  event: PingPongState['lastEvent']
  eventAge: number
  eventLabel: string | null
  rally: number
  situationLabel: string | null
}) {
  const showEvent = Boolean(eventLabel && event && eventAge < 900)
  const label = showEvent ? eventLabel : situationLabel
  const tone = showEvent && event ? feedbackTextClass(event.type) : 'text-[#ffd24a]'
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[17%] z-10 grid justify-items-center gap-3 text-center">
      <div
        className={`min-h-12 text-4xl font-black drop-shadow-[0_3px_12px_rgb(0_0_0_/_80%)] ${tone}`}
      >
        {label && <span className="animate-pp-feedback-pop">{label}</span>}
      </div>
      {rally > 0 && <ComboBadge count={rally} />}
    </div>
  )
}

/**
 * 코트 화면의 워밍업 카드. 대시보드는 구경만 하고(action 없음), 데스크톱 플레이어는 같은
 * 카드에서 준비 완료를 누른다 — 두 사람의 준비 상태를 보는 자리가 하나여야 "상대가 아직
 * 안 눌렀다"가 한눈에 읽힌다.
 */
function PingPongPreparation({
  action,
  heading,
  snapshot,
  state,
}: {
  action?: ReactNode
  heading: string
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
          <h1 className="mt-2 mb-0 text-4xl font-black">{heading}</h1>
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
          {latestPractice ? `${latestPractice.nickname} 연습 스윙 감지!` : '공을 한 번 쳐보세요'}
        </p>
        {action}
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
    <main className="relative flex h-svh w-full flex-col items-center justify-center gap-7 overflow-hidden bg-pingpong-canvas px-gutter text-white">
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
    <main className="relative flex h-svh w-full flex-col items-center justify-center gap-7 overflow-hidden bg-pingpong-canvas px-gutter text-white">
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
  tag,
  large = false,
}: {
  name: string
  score: number
  tone: 'blue' | 'red'
  tag?: string
  large?: boolean
}) {
  return (
    <div
      className={`grid min-w-20 text-center ${tone === 'blue' ? 'text-[#73bfff]' : 'text-[#ff8b7c]'}`}
    >
      <span className="flex min-w-0 items-center justify-center gap-1 text-xs font-bold text-white/65">
        {tag && (
          <span className="rounded border border-current px-1 font-mono text-[10px] font-black leading-none">
            {tag}
          </span>
        )}
        <span className="max-w-28 truncate">{name}</span>
      </span>
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
