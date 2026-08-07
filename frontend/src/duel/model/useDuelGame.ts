import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  type DuelInputSource,
  drawPenaltyMs,
  flightMs,
  impactDelayMs,
  type ShotTarget,
  SWING_THRESHOLD,
} from '@/duel/domain/duel'
import { playGunHit, playGunShot } from '@/duel/sounds'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import { buildClientMessage, DUEL_FOUL, type DuelState } from '@/realtime/wsEvents'
import { useSwing } from '@/shared/useSwing'
import { vibrate } from '@/shared/vibrate'
import type { ActiveRoomSession } from '@/store'

const MEASURED_PAINT_LAG_MS = 45

const SHOT_VIBRATION = 18
const HIT_VIBRATION = [40, 60, 40]
const KO_VIBRATION = [60, 70, 60, 70, 180]

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

export function useDuelGame({ roomId, session, state }: UseDuelGameOptions) {
  const client = useRealtimeClient()
  const stateRef = useRef(state)
  const stageRef = useRef<HTMLElement>(null)
  const inputSeq = useRef(0)
  const signalSeenAt = useRef<number | null>(null)
  const [impact, setImpact] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [myShot, setMyShot] = useState<MyShot | null>(null)
  const penaltyTimer = useRef(NO_TIMER)
  const soundedRound = useRef(0)

  const phase = state?.phase

  useLayoutEffect(() => {
    stateRef.current = state
    signalSeenAt.current = phase === 'SIGNAL' ? (signalSeenAt.current ?? performance.now()) : null
  })

  const flight = flightMs(useStageWidth(stageRef))
  const impactDelay = useImpactDelay(state, session.you, myShot, flight)

  const hitId = state?.lastRound?.hitId
  const koId = state?.lastRound?.koId
  useEffect(() => {
    setImpact(false)
    if (phase !== 'RESULT') return
    const wake = Math.max(0, impactDelay - MEASURED_PAINT_LAG_MS)
    const timeoutId = window.setTimeout(() => {
      setImpact(true)
      if (hitId) playGunHit()
      if (koId === session.you) vibrate(KO_VIBRATION)
      else if (hitId === session.you) vibrate(HIT_VIBRATION)
    }, wake)
    return () => window.clearTimeout(timeoutId)
  }, [phase, impactDelay, hitId, koId, session.you])

  useEffect(() => {
    const round = state?.lastRound
    if (!round || round.number === soundedRound.current || round.kind === 'FORFEIT') return
    soundedRound.current = round.number
    playGunShot()
  }, [state?.lastRound])

  const draw = useCallback(
    (source: DuelInputSource) => {
      const current = stateRef.current
      if (!current) return
      if (current.phase !== 'WAITING' && current.phase !== 'SIGNAL') return
      if (current.reactions[session.you] !== undefined) return
      const early = current.phase === 'WAITING' || signalSeenAt.current === null
      const measured = early
        ? DUEL_FOUL
        : Math.round(performance.now() - (signalSeenAt.current ?? 0))
      const penalty = drawPenaltyMs(measured, source)
      setMyShot({
        firedAtMs: performance.now(),
        round: current.round,
        target: early ? 'ground' : 'opponent',
      })
      soundedRound.current = current.round
      playGunShot()
      vibrate(SHOT_VIBRATION)

      const send = () => {
        penaltyTimer.current = NO_TIMER
        try {
          client.send(
            buildClientMessage(
              'game.duel.draw',
              { inputSeq: ++inputSeq.current, reactionMs: measured + penalty },
              { roomId },
            ),
          )
          setSendError(null)
        } catch {
          setMyShot(null)
          setSendError('연결을 확인한 뒤 다시 뽑아 주세요.')
        }
      }

      penaltyTimer.current = sendAfter(penalty, send)
    },
    [client, roomId, session.you],
  )

  useEffect(() => () => window.clearTimeout(penaltyTimer.current), [])

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
