import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  type DuelInputSource,
  decideDraw,
  flightMs,
  impactDelayMs,
  type ShotTarget,
  SWING_THRESHOLD,
} from '@/duel/domain/duel'
import { playGunHit, playGunShot } from '@/duel/sounds'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import { buildClientMessage, type DuelState } from '@/realtime/wsEvents'
import { useSwing } from '@/shared/useSwing'
import type { ActiveRoomSession } from '@/store'

const MEASURED_PAINT_LAG_MS = 45

/**
 * 기다리는 전송이 없다는 뜻. `setTimeout`은 1부터 세므로 0은 어떤 타이머도 아니고,
 * `clearTimeout(0)`은 아무 일도 하지 않는다 — null을 따로 두고 매번 검사할 이유가 없다.
 */
const NO_TIMER = 0

function useStageWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 390 : window.innerWidth,
  )
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setWidth(element.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}

function useImpactDelay(
  state: DuelState | undefined,
  you: string,
  myShot: MyShot | null,
  flight: number,
) {
  const [measured, setMeasured] = useState({ delayMs: flight, round: 0 })
  if (state?.phase === 'RESULT' && measured.round !== state.round) {
    const last = state.lastRound
    const mineLands = last?.shooterId === you || last?.foulId === you
    const mine = myShot?.round === state.round ? myShot : null
    const flown = mineLands && mine ? performance.now() - mine.firedAtMs : 0
    setMeasured({ delayMs: impactDelayMs(flight, flown), round: state.round })
  }
  return measured.delayMs
}

function sendAfter(penaltyMs: number, send: () => void): number {
  if (penaltyMs === 0) {
    send()
    return NO_TIMER
  }
  return window.setTimeout(send, penaltyMs)
}

interface MyShot {
  firedAtMs: number
  round: number
  target: ShotTarget
}

interface UseDuelGameOptions {
  roomId: string
  session: ActiveRoomSession
  state: DuelState | undefined
}

/** 이벤트 경로(draw)가 읽는 최신 값. 렌더 직후 layout effect가 맞춰 둔다. */
interface DrawRefs {
  stateRef: RefObject<DuelState | undefined>
  /** 내가 신호를 본 시각. 신호 국면이 아니면 null. */
  signalSeenAt: RefObject<number | null>
  /** 마지막으로 총성을 낸 라운드. 내가 쏜 라운드는 서버 결과가 와도 다시 울리지 않는다. */
  soundedRound: RefObject<number>
}

interface DrawCommandOptions extends DrawRefs {
  roomId: string
  you: string
}

/**
 * 총을 뽑는다 — 판정을 내리고 총성을 바로 울린 뒤, 페널티만큼 늦춰 서버로 보낸다.
 * 전송이 실패하면 쏜 기록을 지워 다시 뽑을 수 있게 한다.
 */
function useDrawCommand({ roomId, signalSeenAt, soundedRound, stateRef, you }: DrawCommandOptions) {
  const client = useRealtimeClient()
  const inputSeq = useRef(0)
  const penaltyTimer = useRef(NO_TIMER)
  const [sendError, setSendError] = useState<string | null>(null)
  const [myShot, setMyShot] = useState<MyShot | null>(null)

  const draw = useCallback(
    (source: DuelInputSource) => {
      const current = stateRef.current
      if (!current) return
      if (current.phase !== 'WAITING' && current.phase !== 'SIGNAL') return
      if (current.reactions[you] !== undefined) return
      const decision = decideDraw(current.phase, signalSeenAt.current, performance.now(), source)
      setMyShot({
        firedAtMs: performance.now(),
        round: current.round,
        target: decision.target,
      })
      soundedRound.current = current.round
      playGunShot()

      const send = () => {
        penaltyTimer.current = NO_TIMER
        try {
          client.send(
            buildClientMessage(
              'game.duel.draw',
              {
                inputSeq: ++inputSeq.current,
                reactionMs: decision.reactionMs + decision.penaltyMs,
              },
              { roomId },
            ),
          )
          setSendError(null)
        } catch {
          setMyShot(null)
          setSendError('연결을 확인한 뒤 다시 뽑아 주세요.')
        }
      }

      penaltyTimer.current = sendAfter(decision.penaltyMs, send)
    },
    [client, roomId, signalSeenAt, soundedRound, stateRef, you],
  )

  return { draw, myShot, penaltyTimer, sendError }
}

// 총알이 닿는 순간 — 피격 자세와 체력 감소를 여기에 맞춘다. 서버 시각(lastRound.at)이
// 아니라 로컬 타이머로 세는 이유는 두 기기의 시계가 맞다는 보장이 없기 때문이다.
//
// 타이머는 CSS 지연보다 늦게 도착한다 — 타이머가 깨어난 뒤 React가 다시 렌더하고 화면에
// 칠해지기까지 한두 프레임이 더 걸린다. 실측 50~60ms였다. 그만큼 앞당겨 깨워야 자세가
// 총알과 같은 프레임에 바뀐다. CSS 지연(impactDelay)에는 이 보정을 넣지 않는다.
//
// hitId를 effect 밖에서 꺼내 받는 이유: 안에서 lastRound를 통째로 잡으면 그 객체가
// 의존성이 되고, 서버 갱신마다 참조가 바뀌어 착탄 타이머가 매번 리셋된다.
function useImpactMoment(
  phase: DuelState['phase'] | undefined,
  impactDelay: number,
  hitId: string | null | undefined,
) {
  const [impact, setImpact] = useState(false)
  useEffect(() => {
    setImpact(false)
    if (phase !== 'RESULT') return
    const wake = Math.max(0, impactDelay - MEASURED_PAINT_LAG_MS)
    const timeoutId = window.setTimeout(() => {
      setImpact(true)
      if (hitId) playGunHit()
    }, wake)
    return () => window.clearTimeout(timeoutId)
  }, [phase, impactDelay, hitId])
  return impact
}

/** 상대가 쏜 라운드의 총성. 내가 쏜 라운드는 draw가 이미 울렸다. 기권은 소리가 없다. */
function useShotSound(
  lastRound: DuelState['lastRound'] | undefined,
  soundedRound: DrawRefs['soundedRound'],
) {
  useEffect(() => {
    const round = lastRound
    if (!round || round.number === soundedRound.current || round.kind === 'FORFEIT') return
    soundedRound.current = round.number
    playGunShot()
  }, [lastRound, soundedRound])
}

export function useDuelGame({ roomId, session, state }: UseDuelGameOptions) {
  const stateRef = useRef(state)
  const stageRef = useRef<HTMLElement>(null)
  const signalSeenAt = useRef<number | null>(null)
  const soundedRound = useRef(0)
  const { draw, myShot, penaltyTimer, sendError } = useDrawCommand({
    roomId,
    signalSeenAt,
    soundedRound,
    stateRef,
    you: session.you,
  })

  const phase = state?.phase

  useLayoutEffect(() => {
    stateRef.current = state
    signalSeenAt.current = phase === 'SIGNAL' ? (signalSeenAt.current ?? performance.now()) : null
  })

  const flight = flightMs(useStageWidth(stageRef))
  const impactDelay = useImpactDelay(state, session.you, myShot, flight)
  const impact = useImpactMoment(phase, impactDelay, state?.lastRound?.hitId)
  useShotSound(state?.lastRound, soundedRound)

  useEffect(() => () => window.clearTimeout(penaltyTimer.current), [penaltyTimer])

  const { permission, requestPermission } = useSwing({
    onSwing: () => draw('swing'),
    threshold: SWING_THRESHOLD,
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== 'Space') return
      event.preventDefault()
      draw('key')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draw])

  return {
    draw,
    flight,
    impact,
    impactDelay,
    myShot,
    permission,
    requestPermission,
    sendError,
    stageRef,
  }
}
