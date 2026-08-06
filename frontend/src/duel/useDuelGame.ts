import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import { buildClientMessage, DUEL_FOUL, type DuelState } from '@/realtime/wsEvents'
import { useSwing } from '@/shared/useSwing'
import type { ActiveRoomSession } from '@/store'
import {
  type DuelInputSource,
  drawPenaltyMs,
  flightMs,
  type ShotTarget,
  SWING_THRESHOLD,
} from './duel'
import { playGunHit, playGunShot } from './sounds'

/**
 * 피격 타이머를 이만큼 앞당겨 깨운다. setTimeout이 깨어난 뒤 React 렌더와 페인트가 한두
 * 프레임 더 걸려, 보정 없이 재면 자세가 총알보다 50~60ms 늦게 바뀐다(실측).
 */
const IMPACT_LEAD_MS = 45

/**
 * 기다리는 전송이 없다는 뜻. `setTimeout`은 1부터 세므로 0은 어떤 타이머도 아니고,
 * `clearTimeout(0)`은 아무 일도 하지 않는다 — null을 따로 두고 매번 검사할 이유가 없다.
 */
const NO_TIMER = 0

/**
 * 무대의 실제 폭. 총알 사거리가 여기서 나오므로 창 크기가 바뀌면 다시 잰다.
 * 첫 렌더에도 값이 있어야 하므로(그 라운드의 착탄 시각을 이미 잡아야 한다) 뷰포트 폭으로
 * 시작하고, 마운트 직후 실측으로 바꾼다.
 */
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
  flight: number,
) {
  const delay = useRef(flight)
  const measuredRound = useRef(0)
  if (state?.phase === 'RESULT' && measuredRound.current !== state.round) {
    measuredRound.current = state.round
    const last = state.lastRound
    const mineLands = last?.shooterId === you || last?.foulId === you
    const flown = mineLands && firedAt.current !== null ? performance.now() - firedAt.current : 0
    delay.current = Math.max(0, Math.round(flight - flown))
  }
  return delay
}

/**
 * 페널티만큼 늦춰서 보낸다. 취소할 수 있게 타이머 id를 돌려준다(0이면 지금 보내고 null).
 *
 * <b>왜 늦추는가.</b> 신고 숫자만 키워 보내면 서버가 깎아 버린다 — `DuelRules.draw`가 받은
 * 값을 `now - signalAt`(= 실제 반응 + 왕복 지연)으로 clamp하므로, 왕복이 짧은 회선에서는
 * 얹은 100ms가 통째로 사라진다. 그러면 밸런스가 회선 속도에 따라 달라진다(로컬 개발에서는
 * 페널티가 아예 없다). 전송을 늦추면 서버의 기준 시각도 그만큼 뒤로 밀려 깎이지 않는다.
 */
function sendAfter(penaltyMs: number, send: () => void): number {
  if (penaltyMs === 0) {
    send()
    return NO_TIMER
  }
  return window.setTimeout(send, penaltyMs)
}

interface UseDuelGameOptions {
  roomId: string
  session: ActiveRoomSession
  state: DuelState | undefined
}

/**
 * 결투 한 라운드의 수명주기 — 신호 기준 시각, 뽑기 입력 세 갈래(탭·스페이스·폰 스윙),
 * 낙관적 총알, 착탄 타이밍, 총성, 페널티 지연 전송.
 *
 * 이 훅은 판정을 하지 않는다. 뽑은 순간의 반응 시간만 서버에 올린다(규칙은 서버 소유).
 */
export function useDuelGame({ roomId, session, state }: UseDuelGameOptions) {
  const client = useRealtimeClient()
  const stateRef = useRef(state)
  const stageRef = useRef<HTMLElement>(null)
  const inputSeq = useRef(0)
  /**
   * 내가 신호를 본 시각. 반응 시간을 서버 도착 시각으로 재면 왕복 지연이 그대로
   * 핸디캡이 되므로, 각자 자기 화면 기준으로 재서 올린다(서버가 상한만 검증한다).
   */
  const signalSeenAt = useRef<number | null>(null)
  const [impact, setImpact] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  /**
   * 내가 이번 라운드에 쏜 총알 — 서버 응답을 기다리지 않고 반응한 순간에 총알을 내보내려고
   * 로컬로 기억한다. 라운드 번호를 함께 담는 이유는 다음 라운드가 열리는 순간 비교만으로
   * 자연히 풀리기 때문이다 — effect로 되돌리면 새 라운드의 첫 프레임에 총알이 한 번 스친다.
   */
  const [myShot, setMyShot] = useState<{ round: number; target: ShotTarget } | null>(null)
  /** 내 총알이 떠난 시각. 판정이 늦게 와도 착탄까지 남은 시간을 이만큼 깎는다. */
  const firedAt = useRef<number | null>(null)
  /** 페널티를 기다리는 전송. 이유는 {@link sendAfter}에 있다. */
  const penaltyTimer = useRef(NO_TIMER)
  const soundedRound = useRef(0)

  stateRef.current = state
  // 라운드는 WAITING → SIGNAL → RESULT 를 정확히 한 번씩 거치므로, 아래 두 타이밍은
  // 라운드 번호를 따로 볼 것 없이 국면 변화만으로 라운드마다 새로 잡힌다.
  const phase = state?.phase

  // 신호를 처음 그리는 렌더에서 기준 시각을 잡는다. effect까지 미루면 커밋과 effect 사이에
  // 들어온 아주 빠른 탭이 기준을 못 찾고 부정출발로 신고돼 버린다 — 억울한 경고다.
  // 신호가 아니면 비운다 — 다음 라운드가 지난 라운드의 기준으로 재면 안 된다.
  signalSeenAt.current = phase === 'SIGNAL' ? (signalSeenAt.current ?? performance.now()) : null

  // 이 화면의 사거리에서 나온 비행 시간. 총알 애니메이션과 착탄 타이밍이 같은 값을 쓴다.
  const flight = flightMs(useStageWidth(stageRef))
  const impactDelay = useImpactDelay(state, session.you, firedAt, flight)

  // 총알이 닿는 순간 — 피격 자세와 체력 감소를 여기에 맞춘다. 서버 시각(lastRound.at)이
  // 아니라 로컬 타이머로 세는 이유는 두 기기의 시계가 맞다는 보장이 없기 때문이다.
  //
  // 타이머는 CSS 지연보다 늦게 도착한다 — 타이머가 깨어난 뒤 React가 다시 렌더하고 화면에
  // 칠해지기까지 한두 프레임이 더 걸린다. 실측 50~60ms였다. 그만큼 앞당겨 깨워야 자세가
  // 총알과 같은 프레임에 바뀐다. CSS 지연(impactDelay)에는 이 보정을 넣지 않는다.
  useEffect(() => {
    setImpact(false)
    if (phase !== 'RESULT') return
    const wake = Math.max(0, impactDelay.current - IMPACT_LEAD_MS)
    const timeoutId = window.setTimeout(() => {
      setImpact(true)
      if (state?.lastRound?.hitId) playGunHit()
    }, wake)
    return () => window.clearTimeout(timeoutId)
    // 남은 시간은 판정에 들어서는 렌더에서 이미 확정된다 — 이 국면 안에서는 다시 바뀌지 않는다.
  }, [phase, impactDelay.current, state?.lastRound?.hitId])

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
      // 한 라운드에 한 발이다. 이미 뽑았으면 상대를 기다린다.
      if (current.reactions[session.you] !== undefined) return
      const early = current.phase === 'WAITING' || signalSeenAt.current === null
      const measured = early
        ? DUEL_FOUL
        : Math.round(performance.now() - (signalSeenAt.current ?? 0))
      const penalty = drawPenaltyMs(measured, source)
      // 총알은 지금 떠난다. 판정은 서버가 하지만 손맛까지 왕복 지연을 기다릴 이유는 없다.
      // 신호를 못 본 채 당겼으면 총알은 상대가 아니라 자기 발밑에 박힌다.
      //
      // 페널티가 붙는 입력도 <b>연출은 지금</b> 한다. 총소리와 총알을 100ms 늦추면 탭이
      // 불리해지는 대신 고장난 것처럼 느껴진다 — 페널티는 기록에 걸리는 것이고, 어느 입력이
      // 빠른지는 컨트롤러 화면이 말로 알려 준다.
      firedAt.current = performance.now()
      setMyShot({ round: current.round, target: early ? 'ground' : 'opponent' })
      soundedRound.current = current.round
      playGunShot()

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
          // 못 보냈으면 쏘지 않은 것이다 — 되돌려 다시 뽑을 수 있게 한다.
          firedAt.current = null
          setMyShot(null)
          setSendError('연결을 확인한 뒤 다시 뽑아 주세요.')
        }
      }

      penaltyTimer.current = sendAfter(penalty, send)
    },
    [client, roomId, session.you],
  )

  // 방을 떠나면 기다리던 전송을 취소한다 — 이미 나온 방에 뽑기가 기록되면 안 된다.
  useEffect(() => () => window.clearTimeout(penaltyTimer.current), [])

  // enabled를 따로 걸지 않는다. useSwing은 권한이 허용된 뒤에만 listener를 붙이므로
  // 이 게이트는 중복인데, 실제로는 해가 됐다 — 안드로이드는 권한 API가 없어 마운트 즉시
  // 'granted'가 되고, 그러면 아래 "휘두르기 켜기" 버튼이 뜨지 않아 게이트를 열 방법이
  // 사라진다. 센서는 붙어 있는데 스윙이 전부 버려지는 화면이었다.
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
